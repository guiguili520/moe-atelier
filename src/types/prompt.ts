export interface PromptImage {
  url: string;
}

export interface PromptSimilar {
  content: string;
  contributor?: string;
  notes?: string;
  images?: string[];
}

export interface PromptItem {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  contributor?: string;
  images?: string[];
  similar?: PromptSimilar[];
  isFavorite?: boolean; // 本地状态
}

export interface PromptSection {
  id: string;
  title: string;
  isCollapsed?: boolean;
  isRestricted?: boolean;
  prompts: PromptItem[];
}

export interface PromptData {
  sections: PromptSection[];
  commonTags?: string[];
  siteNotes?: string;
  lastUpdated?: string;
}
