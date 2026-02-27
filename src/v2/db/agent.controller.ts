import { Request, Response } from "express";
import { z } from "zod";

import logger from "../../logger";
import { TranscriptionServiceFactory } from "../../voice-to-text/factories/transcription-service.factory";
import { AgentService } from "./agent.service";
import { dischargeSummaryService } from "./discharge-summary.service";
import { draftServiceProvider } from "./draft-service.provider";
import { DraftService } from "./draft.service";

const PrepareSchema = z.object({
  patientId: z.string().min(1),
  accountNumber: z.string().min(1),
});

const CommitSchema = z.object({
  createdBy: z.string().min(1),
});

const VersionSchema = z.object({
  targetVersion: z.string().regex(/^v\d+$/),
  createdBy: z.string().min(1),
});

export class AgentController {
  private agentService: AgentService;
  private draftService: DraftService;

  constructor() {
    this.draftService = draftServiceProvider.get();
    this.agentService = new AgentService();
  }

  async prepareDraft(req: Request, res: Response) {
    try {
      const parsed = PrepareSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error.errors,
        });
      }

      const { patientId, accountNumber } = parsed.data;
      const userId = (req as any).user?.id || "anonymous";

      const existing = await this.draftService.getDraft(
        patientId,
        accountNumber,
      );
      if (existing?.id) {
        return res.json({
          success: true,
          data: existing!.toJSON(),
        });
      }
      const prepared = await dischargeSummaryService.prepare(
        patientId,
        accountNumber,
      );

      logger.info("Creating draft from prepared summary", {
        patientId,
        accountNumber,
        sectionCount: Object.keys(prepared.sections).length,
      });

      const draft = await this.draftService.prepareDraft({
        patientId,
        accountNumber,
        createdBy: userId,
        draft: prepared.sections,
        sectionReferences: prepared.sectionReferences,
      });

      logger.info("Draft created successfully", {
        patientId,
        accountNumber,
        draftId: draft.id,
      });

      return res.json({
        success: true,
        data: {
          ...draft.toJSON(),
          metadata: prepared.metadata,
        },
      });
    } catch (e: any) {
      logger.error("prepareDraft failed", {
        error: e.message,
        stack: e.stack,
        body: req.body,
      });

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async saveInline(req: Request, res: Response) {
    try {
      const { patientId, accountNumber, sections } = req.body;

      const createdBy = (req as any).user?.id || "anonymous";

      if (!patientId || !accountNumber) {
        return res.status(400).json({
          message: "patientId and accountNumber are required",
        });
      }

      if (!Array.isArray(sections) || sections.length === 0) {
        return res.status(400).json({
          message: "sections must be a non-empty array",
        });
      }

      for (const s of sections) {
        if (!s.id || !s.title || typeof s.content !== "string") {
          return res.status(400).json({
            message: "Each section must have id, title and content",
          });
        }
      }

      const draft = await this.draftService.saveInlineVersion({
        patientId,
        accountNumber,
        createdBy,
        sections,
      });

      return res.status(200).json({
        message: "Version saved successfully",
        draft: draft.toJSON(),
      });
    } catch (error) {
      logger.error("Error in saveInlineVersionController", {
        body: req.body,
        error,
      });

      return res.status(500).json({
        message: "Failed to save inline version",
      });
    }
  }
  async getDraft(req: Request, res: Response) {
    try {
      const { patientId, accountNumber } = req.params;

      const draft = await this.draftService.getDraft(
        patientId as string,
        accountNumber as string,
      );

      if (!draft) {
        return res.status(404).json({
          success: false,
          error: "Draft not found",
        });
      }

      return res.json({
        success: true,
        data: draft.toJSON(),
      });
    } catch (e: any) {
      logger.error("getDraft", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async commit(req: Request, res: Response) {
    try {
      const parsed = CommitSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error.errors,
        });
      }

      const { patientId, accountNumber } = req.params;

      const version = await this.draftService.commitDraft({
        patientId: patientId as string,
        accountNumber: accountNumber as string,
        createdBy: parsed.data.createdBy,
      });

      return res.json({
        success: true,
        data: { version },
      });
    } catch (e: any) {
      logger.error("commit", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async rollback(req: Request, res: Response) {
    try {
      const parsed = VersionSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error.errors,
        });
      }

      const { patientId, accountNumber } = req.params;

      const ok = await this.draftService.rollback({
        patientId: patientId as string,
        accountNumber: accountNumber as string,
        targetVersion: parsed.data.targetVersion,
        createdBy: parsed.data.createdBy,
      });

      if (!ok) {
        return res.status(404).json({
          success: false,
          error: "Version not found",
        });
      }

      return res.json({ success: true });
    } catch (e: any) {
      logger.error("rollback", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async checkout(req: Request, res: Response) {
    try {
      const parsed = VersionSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: parsed.error.errors,
        });
      }

      const { patientId, accountNumber } = req.params;

      const ok = await this.draftService.getSnapshotByVersion({
        patientId: patientId as string,
        accountNumber: accountNumber as string,
        version: 2,
      });

      if (!ok) {
        return res.status(404).json({
          success: false,
          error: "Version not found",
        });
      }

      return res.json({ success: true });
    } catch (e: any) {
      logger.error("checkout", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async history(req: Request, res: Response) {
    try {
      const { patientId, accountNumber } = req.params;

      const history = await this.draftService.getHistory(
        patientId as string,
        accountNumber as string,
      );

      if (!history) {
        return res.status(404).json({
          success: false,
          error: "Draft not found",
        });
      }

      return res.json({
        success: true,
        data: history,
      });
    } catch (e: any) {
      logger.error("history", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async getVersionSnapshot(req: Request, res: Response) {
    try {
      const { patientId, accountNumber, version } = req.params;
      const versionNum = Number((version as string).replace("v", ""));

      if (Number.isNaN(versionNum)) {
        return res.status(400).json({
          success: false,
          error: "Invalid version format",
        });
      }

      const snapshot = await this.draftService.getSnapshotByVersion({
        patientId: patientId as string,
        accountNumber: accountNumber as string,
        version: versionNum,
      });

      if (!snapshot) {
        return res.status(404).json({
          success: false,
          error: "Version not found",
        });
      }

      return res.json({
        success: true,
        data: snapshot,
      });
    } catch (e: any) {
      logger.error("getVersionSnapshot", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async invoke(req: Request, res: Response) {
    try {
      const { patientId, accountNumber, messages } = req.body;

      if (!patientId || !accountNumber) {
        return res.status(400).json({
          success: false,
          error: "patientId and accountNumber required",
        });
      }

      const userId = (req as any).user?.id || "anonymous";

      const result = await this.agentService.invoke(messages, userId, {
        patientId: patientId as string,
        accountNumber: accountNumber as string,
      });

      return res.json({ success: true, data: result });
    } catch (e: any) {
      logger.error("invoke", e);

      return res.status(500).json({
        success: false,
        error: e.message,
      });
    }
  }

  async discard(req: Request, res: Response) {
    try {
      const { patientId, accountNumber } = req.params;

      // const ok = await this.draftService.discardDraft({
      //   patientId: patientId as string,
      //   accountNumber: accountNumber as string,
      // });

      // if (!ok) {
      //   return res
      //     .status(404)
      //     .json({ success: false, error: "Draft not found" });
      // }

      return res.json({ success: true });
    } catch (e: any) {
      logger.error("discard", e);
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async processVoiceCommand(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id || "anonymous";
      const { autoProcess } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No audio file provided",
        });
      }

      const transcriptionService = TranscriptionServiceFactory.getService();

      const transcribedText = await transcriptionService.transcribe(
        req.file.buffer,
        req.file.mimetype,
      );

      logger.info("Voice command transcribed", {
        userId,
        originalText: transcribedText,
        autoProcess,
      });

      return res.json({
        success: true,
        data: {
          transcription: transcribedText,
          autoProcessed: false,
        },
      });
    } catch (error: any) {
      logger.error("processVoiceCommand error", {
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: "Voice command processing failed",
        message: error.message,
      });
    }
  }
}
