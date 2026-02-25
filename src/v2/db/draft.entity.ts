import { SectionEntity } from "./section.entity";
import { Reference } from "../../agents/types/draft-summary";

export class DraftEntity {
  readonly id: string;
  readonly patientId: string;
  readonly accountNumber: string;
  readonly createdBy: string;

  private _currentVersion: number;
  private _nextVersion: number;

  private _sections: SectionEntity[];
  private _references: Map<string, Reference>;

  constructor(params: {
    id: string;
    patientId: string;
    accountNumber: string;
    createdBy: string;

    initialSections: SectionEntity[];

    references?: Reference[];

    currentVersion?: number;
    nextVersion?: number;
  }) {
    this.id = params.id;
    this.patientId = params.patientId;
    this.accountNumber = params.accountNumber;
    this.createdBy = params.createdBy;

    this._sections = params.initialSections ?? [];

    this._references = new Map(
      (params.references ?? []).map((r) => [r.id, r]),
    );

    this._currentVersion = params.currentVersion ?? 0;
    this._nextVersion = params.nextVersion ?? 1;
  }

  get currentVersion(): string {
    return `v${this._currentVersion}`;
  }

  get currentVersionNumber(): number {
    return this._currentVersion;
  }

  get nextVersionNumber(): number {
    return this._nextVersion;
  }

  get sections(): SectionEntity[] {
    return this._sections;
  }

  get references(): Reference[] {
    return Array.from(this._references.values());
  }

  getSection(id: string): SectionEntity | undefined {
    return this._sections.find((s) => s.id === id);
  }

  addOrUpdateReferences(refs: Reference[]): void {
    for (const r of refs) {
      this._references.set(r.id, r);
    }
  }

  getReference(id: string): Reference | undefined {
    return this._references.get(id);
  }

  advanceVersion(): void {
    this._currentVersion = this._nextVersion;
    this._nextVersion += 1;
  }

  restoreSections(sections: SectionEntity[]): void {
    this._sections = sections;
  }

  restoreReferences(refs: Reference[]): void {
    this._references = new Map(refs.map((r) => [r.id, r]));
  }

  toJSON() {
    return {
      id: this.id,
      patientId: this.patientId,
      accountNumber: this.accountNumber,
      createdBy: this.createdBy,
      currentVersion: this._currentVersion,
      nextVersion: this._nextVersion,
      sections: this._sections.map((s) => s.toJSON()),
      references: this.references,
    };
  }

  static fromJSON(data: any): DraftEntity {
    const sections = (data.sections ?? []).map((s: any) =>
      SectionEntity.fromJSON(s),
    );

    return new DraftEntity({
      id: data.id,
      patientId: data.patientId,
      accountNumber: data.accountNumber,
      createdBy: data.createdBy,
      initialSections: sections,
      references: data.references ?? [],
      currentVersion: data.currentVersion,
      nextVersion: data.nextVersion,
    });
  }
}