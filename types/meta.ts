export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

export interface MetaAdSet {
  id: string;
  name: string;
  status: string;
  daily_budget: string;
  campaign: MetaCampaign;
}

export interface MetaCreative {
  id: string;
  name?: string;
  object_type: string;
  thumbnail_url?: string;
  image_url?: string;
}

export interface MetaAdInsights {
  spend?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  creative?: MetaCreative;
  adset: MetaAdSet;
  insights?: { data: MetaAdInsights[] };
}

export interface AdsByAdSet {
  adset: Omit<MetaAdSet, "campaign">;
  ads: MetaAd[];
}

export interface AdsByCampaign {
  campaign: MetaCampaign;
  adsets: Record<string, AdsByAdSet>;
  adCount: number;
}

export interface GroupedAds {
  campaigns: Record<string, AdsByCampaign>;
  totalAds: number;
  totalCampaigns: number;
  totalAdSets: number;
}
