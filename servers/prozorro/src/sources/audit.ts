import { requestJson } from "../http.js";

/**
 * Моніторинги Держаудитслужби: the state audit service's checks of individual
 * procurements.
 *
 * This is a different kind of data from everything else the server holds. A
 * shared phone between bidders is a hint; a price above the median is a
 * question. A monitoring conclusion is a finding by the body empowered to make
 * it — `violationOccurred` is a fact that can be stated as one, and a
 * `declined` conclusion is just as useful in the other direction: it says the
 * auditors looked and found nothing.
 *
 * Verified against the live API 27.08.2026. The service runs on its own host
 * with the same feed shape as the procurement API, and every monitoring
 * carries the `tender_id` of the procedure it concerns — the same uuid the
 * local index already uses as a primary key.
 */

const BASE = "https://audit-api.prozorro.gov.ua/api/2.5";

export type MonitoringConclusion = {
  violationOccurred?: boolean;
  violationType?: string[];
  description?: string;
  auditFinding?: string;
  stringsAttached?: string;
  dateCreated?: string;
};

export type Monitoring = {
  id: string;
  monitoring_id?: string;
  tender_id?: string;
  status?: string;
  reasons?: string[];
  procuringStages?: string[];
  monitoringPeriod?: { startDate?: string; endDate?: string };
  conclusion?: MonitoringConclusion;
  dateModified?: string;
  dateCreated?: string;
};

export type MonitoringFeedPage = {
  data: Array<{ id: string; dateModified: string }>;
  next_page?: { offset?: string };
};

/**
 * One page of the change feed. Same contract as the procurement feed: an
 * opaque offset, newest-last unless `descending` is set.
 */
export async function fetchMonitoringFeed(options: {
  offset?: string;
  limit?: number;
  descending?: boolean;
}): Promise<MonitoringFeedPage> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 1000));
  if (options.offset) params.set("offset", options.offset);
  if (options.descending) params.set("descending", "1");

  return requestJson<MonitoringFeedPage>(`${BASE}/monitorings?${params}`);
}

/** The full record, including the conclusion when one has been issued. */
export async function fetchMonitoring(id: string): Promise<Monitoring> {
  const response = await requestJson<{ data: Monitoring }>(`${BASE}/monitorings/${id}`);
  return response.data;
}

/**
 * What a status means in plain words, because the raw value is not obvious
 * even to someone who works with procurement.
 *
 * Read off real records 27.08.2026: `active` is a check in progress with no
 * conclusion yet, `addressed` and `declined` both carry one — the difference
 * is what it says, not whether it exists.
 */
export const STATUS_MEANING: Record<string, string> = {
  draft: "моніторинг ще не почався",
  active: "моніторинг триває, висновку ще немає",
  addressed: "моніторинг завершено, висновок надіслано замовнику",
  declined: "моніторинг завершено, порушень не встановлено",
  closed: "моніторинг закрито",
  stopped: "моніторинг зупинено",
  cancelled: "моніторинг скасовано",
  completed: "моніторинг завершено",
};

/** Why the audit service started looking. */
export const REASON_MEANING: Record<string, string> = {
  indicator: "спрацював автоматичний індикатор ризику",
  fiscal: "дані органів державного фінансового контролю",
  media: "публікації в засобах масової інформації",
  public: "звернення громадськості",
  authorities: "інформація від органів влади",
};
