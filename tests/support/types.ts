export const STATUSES = ['wishlist', 'applied', 'interview', 'offer', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

export interface ApplicationInput {
  company: string;
  role: string;
  status?: Status;
  appliedOn?: string;
  location?: string;
  link?: string;
  notes?: string;
}

export interface Application extends Required<ApplicationInput> {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  token: string;
  createdAt: string;
  expiresAt: string;
  seeded: boolean;
}
