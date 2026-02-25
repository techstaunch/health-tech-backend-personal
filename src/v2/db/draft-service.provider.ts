import { SearchService } from "./search.service";
import { DraftRepository } from "./draft.repository";
import { DraftService } from "./draft.service";
/* ----------------------------------
   Singletons
---------------------------------- */

const repository = new DraftRepository();
const searchService = new SearchService();

/* ----------------------------------
   Provider — single instance shared across the app
---------------------------------- */

class DraftServiceProvider {
    private instance: DraftService | null = null;

    get(): DraftService {
        if (!this.instance) {
            this.instance = new DraftService(repository, searchService);
        }
        return this.instance;
    }
}

export const draftServiceProvider = new DraftServiceProvider();