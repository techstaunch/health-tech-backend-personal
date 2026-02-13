import FlexSearch from "flexsearch";
import { Section } from "./section.utils";

/**
 * Creates a FlexSearch index from an array of Section objects.
 * The index is configured to search across 'title' and 'content' fields.
 * 
 * @param sections - The array of Section objects to be indexed.
 * @returns A FlexSearch.Document instance containing the indexed data.
 */
export const createSectionIndex = (sections: Section[]) => {
    const index = new FlexSearch.Document({
        document: {
            id: "id",
            index: ["title", "content"],
        },
    });

    sections.forEach((section) => {
        index.add(section);
    });

    return index;
};
