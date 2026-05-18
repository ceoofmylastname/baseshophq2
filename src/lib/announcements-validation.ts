/**
 * Phase 19.2 -- pure form-validation helper for the Settings Announcements
 * edit form.
 *
 * Mirrors the server-side gates inside upsert_announcement (title non-empty
 * after trim; tenant scope enforced by RLS) plus length caps that the brief
 * locks at L-4: title 80 chars max, body 2000 chars max. Body is not
 * required (the underlying announcements.body column is NOT NULL but accepts
 * empty string; existing post_announcement RPC writes empty bodies without
 * complaint).
 *
 * Pure module, no React or Supabase imports.
 */

export const TITLE_MAX = 80;
export const BODY_MAX = 2000;

export type ValidationError = {
  field: "title" | "body";
  message: string;
};

export function validateAnnouncementInput(input: {
  title: string;
  body: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];

  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length === 0) {
    errors.push({ field: "title", message: "Title is required." });
  } else if (trimmedTitle.length > TITLE_MAX) {
    errors.push({
      field: "title",
      message: `Title must be ${TITLE_MAX} characters or fewer.`,
    });
  }

  if (input.body.length > BODY_MAX) {
    errors.push({
      field: "body",
      message: `Body must be ${BODY_MAX} characters or fewer.`,
    });
  }

  return errors;
}
