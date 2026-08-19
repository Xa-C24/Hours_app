const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FLASH_STORAGE_KEY,
  MAX_VISIBLE_TOASTS,
  normalizeToastInput,
  createToastQueue,
} = require("../public/toast-center");

test("normalizeToastInput keeps supported types and readable defaults", () => {
  const toast = normalizeToastInput({
    type: "success",
    message: "  Journée enregistree  ",
  });

  assert.equal(toast.type, "success");
  assert.equal(toast.message, "Journée enregistree");
  assert.equal(toast.role, "status");
  assert.equal(toast.dismissible, true);
});

test("normalizeToastInput clamps invalid values", () => {
  const toast = normalizeToastInput({
    type: "unknown",
    message: "Erreur",
    duration: 50,
    dismissible: false,
  });

  assert.equal(toast.type, "info");
  assert.equal(toast.role, "status");
  assert.equal(toast.duration, 1200);
  assert.equal(toast.dismissible, false);
});

test("createToastQueue disposes oldest entries beyond the visible limit", () => {
  let disposed = 0;
  const queue = createToastQueue(2);
  const first = { dispose: () => { disposed += 1; } };
  const second = { dispose: () => { disposed += 1; } };
  const third = { dispose: () => { disposed += 1; } };

  queue.push(first);
  queue.push(second);
  queue.push(third);

  assert.equal(disposed, 1);
  assert.equal(queue.size(), 2);
});

test("toast constants stay stable for frontend integrations", () => {
  assert.equal(FLASH_STORAGE_KEY, "hours_toast_flash");
  assert.equal(MAX_VISIBLE_TOASTS, 3);
});
