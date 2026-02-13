import { Request, Response } from "express";
import { AzureTranscriptionService } from "../voice-to-text/services/azure-transcription.service";
import { createEmbedding } from "../utils/embedding.utils";
import { createSectionIndex } from "../utils/search.utils";
import { cosineSimilarity } from "../utils/math.utils";
import { transformJsonToSections, Section } from "../utils/section.utils";
import logger from "../logger";

// Mock Data (replace with database/service later)
const MOCK_PATIENT_DATA = {
    "BRIEF ADMISSION HISTORY/REASON FOR ADMISSION:": "BRIEF ADMISSION HISTORY/REASON FOR ADMISSION:  \nThe patient was admitted on 01/30/2024 under a Physician's Emergency Certificate (PEC) following a suicide attempt via overdose of antipsychotic medication on 01/29/2024. The patient reported feeling overwhelmed due to significant stressors, including his daughter's paralysis from a drive-by shooting and interpersonal conflicts with his girlfriend and mother related to methamphetamine abuse. He endorsed suicidal ideations, delusions, paranoia, visual hallucinations (associated with methamphetamine use), irritability, talkativeness, and feelings of being watched by people or electronic devices. The patient's psychiatric condition required inpatient treatment as it could not be managed at a less restrictive level of care [T263513].",
    "LAB AND X-RAY RESULTS/RESULTS OF HISTORY AND PHYSICAL:": "LAB AND X-RAY RESULTS/RESULTS OF HISTORY AND PHYSICAL:  \nNA",
    "COURSE OF TREATMENT:   Patient is admitted to the Brentwood Hospital inpatient unit and started on routine precautions with close observation every 15 min, activities as tolerated, option of gym activities as tolerated.  Patient was started on p.r.n. medications as needed as standby for anxiety, panic and agitation, and any behavioral disturbances. Pain medications made available as needed.  Seen by Social Services to complete psychosocial assessment and family session.  Patient was scheduled to attend groups every day and was seen by the psychiatry team every day for daily evaluation, assessment and progress, and updated clinicals, with adjusted medications as needed depending on the presentation.": "COURSE OF TREATMENT:   Patient is admitted to the Brentwood Hospital inpatient unit and started on routine precautions with close observation every 15 min, activities as tolerated, option of gym activities as tolerated.  Patient was started on p.r.n. medications as needed as standby for anxiety, panic and agitation, and any behavioral disturbances. Pain medications made available as needed.  Seen by Social Services to complete psychosocial assessment and family session.  Patient was scheduled to attend groups every day and was seen by the psychiatry team every day for daily evaluation, assessment and progress, and updated clinicals, with adjusted medications as needed depending on the presentation. [T263517]",
    "MENTAL STATUS EXAMINATION AT DISCHARGE:": "MENTAL STATUS EXAMINATION AT DISCHARGE:  \nThe patient was casually dressed, cooperative, and displayed fair eye contact. He had multiple tattoos and his mood was described as \"I'm doing good,\" with a congruent affect. His thought process was organized, and his thought content showed no suicidal ideation (SI), homicidal ideation (HI), or audiovisual hallucinations. The patient was oriented to person, place, and time (oriented x3). Attention and concentration were noted to be improving. Sleep quality was reported as good, appetite as normal, and energy levels were reported as normal. There were no signs of psychomotor agitation or retardation observed [T263519].",
    "CONDITION AT DISCHARGE:": "CONDITION AT DISCHARGE:",
    "Psychiatric:  Improved.": "Psychiatric: Improved.  \nThe patient's psychiatric condition showed improvement over the course of treatment. Initially, the patient presented with symptoms including anxiety, paranoia, mood swings, suicidal ideations, and delusions [T263513]. Progress notes indicate gradual stabilization with reports of medication helping reduce suicidal thoughts and improving sleep and concentration [T263515; T263518]. By discharge on 02/07/2024, the patient denied suicidal ideations (SI), homicidal ideations (HI), hallucinations, or acute issues and reported feeling \"good\" with normal energy levels and no side effects from medications [T263519].",
    "Physical:  Stable.": "Physical: Stable.  \nThe patient's physical condition is described as stable, with no acute distress or issues noted in the provided documentation. Vital signs were reported as normal and improving [T263516, T263518, T263519]. The patient denied any side effects from medications and showed no signs of psychomotor agitation or retardation during the mental status examinations [T263515, T263518]. Additionally, the patient appeared cooperative and exhibited normal energy levels at discharge [T263519].",
    "Social Functioning:  Improved.": "Social Functioning: Improved.  \nThe patient's social functioning has shown improvement as evidenced by their cooperative behavior, willingness to answer questions, and denial of suicidal ideations (SI), homicidal ideations (HI), hallucinations, or acute issues during the most recent progress note dated 02/07/2024. The patient also expressed readiness for discharge and demonstrated stable mental status with organized thought processes and congruent affect [T263519].",
    "PROGNOSIS:": "PROGNOSIS:  \nThe prognosis for the patient is described as \"guarded\" in the documentation [T263513]. This indicates that while there may be potential for improvement, the outcome remains uncertain and requires close monitoring.",
    "DISCHARGE INSTRUCTIONS:": "DISCHARGE INSTRUCTIONS:",
    "Diet:  Regular.": "Diet:  Regular.  \nThe patient is prescribed a regular diet as part of their care plan, with no specific dietary restrictions or modifications mentioned in the provided documentation. [T263517-T263519]",
    "Activity:  As tolerated.": "Activity: As tolerated.  \nThe phrase \"As tolerated\" in the context of activity indicates that the patient is encouraged to engage in activities based on their comfort level and ability, without pushing beyond what they can manage safely or comfortably. This approach allows for flexibility and self-regulation depending on the patient's physical and mental state at any given time.",
    "Medications:": "Medications:  \n1. **Trileptal** - Increased to 300 mg b.i.d. [T263517], adjusted to 300 mg at night and 150 mg in the morning [T263515].  \n2. **Effexor (venlafaxine)** - Continued as part of treatment plan [T263514, T263516, T263518].  \n3. **Risperidone (Risperdal)** - Continued as part of treatment plan; long-acting injectable restarted [T263513, T263514, T263516].  \n4. **Amantadine** - Started for cravings related to stimulant use; off-label use discussed with patient [T263517, T263518].  \n\nThe medications listed above are prescribed for managing the patient's psychiatric symptoms and addressing specific issues such as mood stabilization, cravings for stimulants, and schizoaffective disorder symptoms.",
    "Allergies:": "Allergies:  \nThe patient has no reported allergies as explicitly stated in the provided documents [T263513].",
    "CONSULTATIONS:  H&P completed.": "CONSULTATIONS:  H&P completed.",
    "DISCHARGE DIAGNOSES:": "DISCHARGE DIAGNOSES:",
    "Psychiatric:": "Psychiatric:  \nThe patient has a history of schizoaffective disorder, depression type, and amphetamine use disorder (mild) [T263513]. The patient was admitted on 01/30/2024 following a suicide attempt via overdose on antipsychotic medication due to overwhelming stressors, including his daughter's paralysis from a drive-by shooting and interpersonal conflicts related to methamphetamine abuse [T263513]. Symptoms during admission included suicidal ideations, delusions, paranoia, visual hallucinations (associated with methamphetamine use), anxiety, mood swings, irritability, and feelings of hopelessness [T263513].\n\nThroughout the hospitalization period from 01/30/2024 to 02/07/2024:\n- The patient reported symptoms such as anxiety, paranoia (\"people are after him\"), mood swings (initially), low energy levels, episodes of depression and delusions but denied audiovisual hallucinations except when associated with substance use. He also experienced guarded behavior and limited insight/judgment across multiple evaluations [T263514; T263515; T263516].\n- Progressively improved mental status was noted with better sleep patterns and concentration by discharge. Suicidal thoughts were alleviated by medication management. By discharge on 02/07/2024, the patient denied SI or HI and appeared stable without acute psychiatric issues [T263518; T263519].\n\nMedications prescribed during treatment included Effexor (venlafaxine), risperidone (including long-acting injectable form), Trileptal (oxcarbazepine) adjusted to 300 mg b.i.d., amantadine for cravings related to stimulant use. P.r.n. medications were also in place as needed for symptom management [T263517; T263514; T263518].",
    "Medical:": "Medical:  \nThe prescribed medications and their daily dosages are as follows:  \n\n1. **Trileptal**: Increased to 300 mg b.i.d. [T263517]. Adjusted to 300 mg at night and 150 mg in the morning [T263515]. Continued at this dosage [T263516, T263518].  \n2. **Effexor** (venlafaxine): Started for mood symptoms [T263513], continued throughout treatment plan [T263514, T263515, T263516, T263518].  \n3. **Risperidone** (Risperdal): Restarted as long-acting injectable for schizoaffective disorder and continued throughout treatment plan [T263513, T263514, T263515, T263516, T263518].  \n4. **Amantadine**: Started for cravings related to stimulant use; off-label use discussed with patient [T263517], continued during treatment plan [T263518].\n\nThese medications were part of the patient's psychiatric management aimed at stabilizing symptoms such as anxiety, paranoia, mood swings, suicidal ideations, and cravings associated with substance abuse disorders while addressing underlying schizoaffective disorder and depression type diagnoses.",
    "Psychosocial and Contextual Factors:": "Psychosocial and Contextual Factors:  \nThe patient is experiencing significant psychosocial and contextual challenges, including problems with their primary support group, such as interpersonal conflicts with their girlfriend and mother due to methamphetamine abuse. The patient also faces economic difficulties, is currently unemployed, and has a history of legal issues including multiple arrests. Additionally, the patient is dealing with emotional stressors related to personal circumstances such as his daughter's recent paralysis from a drive-by shooting. These factors contribute to the patient's overall mental health challenges [T263513].",
    "DISCHARGE DISPOSITION AND AFTERCARE:  Patient is discharged from Brentwood Hospital with follow-up appointments scheduled at .": "DISCHARGE DISPOSITION AND AFTERCARE:  Patient is discharged from Brentwood Hospital with follow-up appointments scheduled at .  \nNA",
    "Discussed about PCP appointments and checking the labs on follow-up visits. Risk assessment safety plan discussed, emergency options discussed.  Patient to call 911 or go to nearest emergency room if feeling suicidal, homicidal or any worsening of conditions or any other life-threatening emergencies.": "Discussed about PCP appointments and checking the labs on follow-up visits. Risk assessment safety plan discussed, emergency options discussed.  Patient to call 911 or go to nearest emergency room if feeling suicidal, homicidal or any worsening of conditions or any other life-threatening emergencies.",
    "Patient not to have access to firearms until next follow-up appointments and continued stability.": "Patient not to have access to firearms until next follow-up appointments and continued stability.\n\nExplanation: Based on the provided documents, the patient has a history of schizoaffective disorder, depression type, amphetamine use disorder (mild), suicidal ideations, paranoia, delusions, and a recent suicide attempt via overdose. These factors indicate significant mental health concerns that could pose risks if firearms were accessible. The restriction is likely a precautionary measure to ensure safety while the patient continues treatment and demonstrates sustained stability in their mental health condition [T263513], [T263514], [T263516].",
};

export class HybridSearchController {
    private transcriptionService: AzureTranscriptionService;

    constructor() {
        this.transcriptionService = new AzureTranscriptionService();
    }

    /**
     * Handles audio upload, transcription, and performs hybrid search.
     */
    public search = async (req: Request, res: Response): Promise<void> => {
        try {
            const file = req.file;
            if (!file) {
                res.status(400).json({ error: "No audio file uploaded." });
                return;
            }

            logger.info("Hybrid search initiated via audio upload.");

            // 1. Convert Voice to Text
            const transcription = await this.transcriptionService.transcribe(
                file.buffer,
                file.mimetype
            );
            logger.info("Transcription completed", { transcription });

            // 2. Prepare Sections
            const sections: Section[] = transformJsonToSections(MOCK_PATIENT_DATA);

            // 3. Generate Embeddings for all sections (if not already cached/stored)
            // In a real app, these would be pre-calculated and stored in a vector DB
            for (const section of sections) {
                if (!section.embedding) {
                    section.embedding = await createEmbedding(section.content);
                }
            }

            // 4. Create FlexSearch Index
            const index = createSectionIndex(sections);

            // 5. Generate Embedding for Query
            const queryEmbedding = await createEmbedding(transcription);

            // 6. Perform Hybrid Search
            // Keyword Search (FlexSearch)
            const keywordHits = await index.searchAsync(transcription, { limit: 5 });

            // Collect keyword hit IDs
            // FlexSearch returns hits as an array of result sets. 
            // Assuming standard search, we check 'content' and 'title' fields.
            const keywordHitIds = new Set<number>();
            // Flatten results from all fields
            (keywordHits as any[]).forEach((result: any) => {
                result.result.forEach((id: number) => keywordHitIds.add(id));
            });


            // Calculate scores
            const scoredSections = sections.map((section) => {
                const keywordScore = keywordHitIds.has(section.id) ? 1 : 0;

                // Ensure embedding exists (it should, from step 3)
                const semanticScore = section.embedding
                    ? cosineSimilarity(queryEmbedding, section.embedding)
                    : 0;

                return {
                    ...section,
                    score: keywordScore + semanticScore,
                    keywordMatch: keywordScore > 0,
                    semanticScore
                };
            });

            // Sort by score (descending) and take top 3
            const topResults = scoredSections
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);

            res.status(200).json({
                transcription,
                originalSections: sections, // sending full sections including embeddings
                results: topResults
            });

        } catch (error) {
            logger.error("Hybrid search failed", { error });
            res.status(500).json({
                error: "Internal server error during hybrid search.",
                details: error instanceof Error ? error.message : String(error)
            });
        }
    };
}
