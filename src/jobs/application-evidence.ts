// A database status alone is not proof that an employer received an application.
export function hasSubmissionEvidence(app: any): boolean {
  if (app.status !== 'APPLIED' || !app.appliedAt) return false;
  const m = app.matchReasons;
  if (!m || Array.isArray(m) || typeof m !== 'object') return false;
  const evidence = m.browserConfirmation || m.agentConfirmation ||
    (m.source === 'verified-private-browser' ? m.receipt : null);
  if (!evidence || typeof evidence !== 'object') return false;
  if (!/(application (has been |was )?(submitted|received)|thank you for (applying|your application)|successfully applied|applied to\b|applied on naukri|already applied|application sent today)/i.test(evidence.text || '')) return false;
  const time = Date.parse(evidence.observedAt || evidence.at || '');
  if (!Number.isFinite(time) || time > Date.now() + 60000) return false;
  if (m.source === 'verified-private-browser' || m.agentConfirmation) {
    try { const u = new URL(evidence.url); if (u.protocol !== 'https:' || u.username || u.password) return false; }
    catch { return false; }
  }
  return true;
}
