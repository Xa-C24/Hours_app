(() => {
  const DRAFT_STORAGE_PREFIX = "hours:draft";
  const DRAFT_FIELDS = [
    "clientId",
    "workDate",
    "dayType",
    "arrivalTime",
    "departureTime",
    "lunchBreakMinutes",
    "commentText",
  ];

  function createDraftStorageKey(clientId, workDate, owner = "") {
    const safeClientId = String(clientId || "").trim();
    const safeWorkDate = String(workDate || "").trim();
    const prefix = owner ? `${DRAFT_STORAGE_PREFIX}:v2:${encodeURIComponent(owner)}` : DRAFT_STORAGE_PREFIX;
    return `${prefix}:${safeClientId}:${safeWorkDate}`;
  }

  function normalizeDraftPayload(payload = {}) {
    return {
      clientId: String(payload.clientId || "").trim(),
      workDate: String(payload.workDate || "").trim(),
      dayType: String(payload.dayType || "").trim(),
      arrivalTime: String(payload.arrivalTime || "").trim(),
      departureTime: String(payload.departureTime || "").trim(),
      lunchBreakMinutes: String(payload.lunchBreakMinutes || "").trim(),
      commentText: String(payload.commentText || ""),
    };
  }

  function isMeaningfulDraft(payload, baseline = {}) {
    const draft = normalizeDraftPayload(payload);
    const base = normalizeDraftPayload(baseline);
    return DRAFT_FIELDS.some((field) => draft[field] !== base[field]);
  }

  function shouldRestoreDraft({ serverEntry = null, draftEntry = null } = {}) {
    return !serverEntry && Boolean(draftEntry);
  }

  function createEntryDraftStore(storage, owner = "") {
    const scopedKey = (clientId, workDate) => createDraftStorageKey(clientId, workDate, owner);
    return {
      key(clientId, workDate) {
        return scopedKey(clientId, workDate);
      },
      get(clientId, workDate) {
        const key = scopedKey(clientId, workDate);
        try {
          const rawValue = storage.getItem(key);
          if (!rawValue) {
            return null;
          }
          const parsed = JSON.parse(rawValue);
          const draft = normalizeDraftPayload(parsed);
          if (!draft.clientId || !draft.workDate) {
            storage.removeItem(key);
            return null;
          }
          return draft;
        } catch (error) {
          storage.removeItem(key);
          return null;
        }
      },
      set(payload) {
        const draft = normalizeDraftPayload(payload);
        if (!draft.clientId || !draft.workDate) {
          return null;
        }
        storage.setItem(scopedKey(draft.clientId, draft.workDate), JSON.stringify(draft));
        return draft;
      },
      remove(clientId, workDate) {
        storage.removeItem(scopedKey(clientId, workDate));
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DRAFT_STORAGE_PREFIX,
      DRAFT_FIELDS,
      createDraftStorageKey,
      normalizeDraftPayload,
      isMeaningfulDraft,
      shouldRestoreDraft,
      createEntryDraftStore,
    };
  }

  if (typeof window === "undefined") {
    return;
  }

  window.hoursEntryDraftStore = {
    createDraftStorageKey,
    normalizeDraftPayload,
    isMeaningfulDraft,
    shouldRestoreDraft,
    createEntryDraftStore,
  };
})();
