export interface Section {
    id: number;
    title: string;
    content: string;
    embedding?: number[];
    [key: string]: any;
}

/**
 * Transforms a JSON object (record) into an array of Section objects.
 * Keys become titles, values become content.
 * 
 * @param data - The source JSON object where keys are titles and values are content strings.
 * @returns An array of Section objects with id, title, and content.
 */
export const transformJsonToSections = (data: Record<string, string>): Section[] => {
    return Object.entries(data).map(([title, content], index) => ({
        id: index,
        title,
        content
    }));
};
