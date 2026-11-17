import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import type { Application, ApplicationInput, Status } from './types';

/** Thin typed wrapper around the REST API, used for test setup and API assertions. */
export class ApiClient {
  constructor(private readonly request: APIRequestContext, readonly token: string) {}

  get headers() {
    return { authorization: `Bearer ${this.token}` };
  }

  list(params: { status?: Status | string; q?: string; sort?: string } = {}): Promise<APIResponse> {
    return this.request.get('/api/applications', { headers: this.headers, params });
  }

  create(data: ApplicationInput | Record<string, unknown>): Promise<APIResponse> {
    return this.request.post('/api/applications', { headers: this.headers, data });
  }

  get(id: string): Promise<APIResponse> {
    return this.request.get(`/api/applications/${id}`, { headers: this.headers });
  }

  update(id: string, data: Record<string, unknown>): Promise<APIResponse> {
    return this.request.patch(`/api/applications/${id}`, { headers: this.headers, data });
  }

  remove(id: string): Promise<APIResponse> {
    return this.request.delete(`/api/applications/${id}`, { headers: this.headers });
  }

  stats(): Promise<APIResponse> {
    return this.request.get('/api/stats', { headers: this.headers });
  }

  /** Create and assert success in one step, for arranging test data. */
  async seed(data: ApplicationInput): Promise<Application> {
    const res = await this.create(data);
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }
}
