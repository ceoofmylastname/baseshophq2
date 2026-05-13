import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Calendar, Clock, Check, X, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  source?: string;
};

const AGENCY_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;
type AgencySize = (typeof AGENCY_SIZES)[number];

/** 30-minute slots between 9:00 AM and 6:00 PM Pacific (Las Vegas business hours). */
const TIME_SLOTS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
];

function formatTime(slot: string): string {
  const [h, m] = slot.split(":").map(Number);
  const hr = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

function generateDateGrid(weeksAhead: number = 3): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < weeksAhead * 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    // Skip weekends — life insurance agencies usually operate weekdays.
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    days.push(d);
  }
  return days;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/**
 * Combine a calendar Date and a time slot into a UTC ISO timestamp.
 * Treat the time slot as Las Vegas / Pacific time (per user's business
 * preference); convert to UTC for storage so it round-trips correctly.
 */
function combineDateTime(date: Date, timeSlot: string): string {
  const [hh, mm] = timeSlot.split(":").map(Number);
  // Build the Las Vegas-localized timestamp via the en-US TZ formatter trick.
  const localDate = new Date(date);
  localDate.setHours(hh, mm, 0, 0);
  // Compute timezone offset for Las Vegas (PST=-8h, PDT=-7h) using Intl.
  const tzOffsetMs = (() => {
    const utcDate = new Date(localDate.toLocaleString("en-US", { timeZone: "UTC" }));
    const pstDate = new Date(localDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    return utcDate.getTime() - pstDate.getTime();
  })();
  return new Date(localDate.getTime() + tzOffsetMs).toISOString();
}

export function DemoBookingModal({ open, onClose, source = "homepage" }: Props) {
  const [step, setStep] = useState<"form" | "slot" | "submitting" | "success">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [agencySize, setAgencySize] = useState<AgencySize | "">("");
  const [message, setMessage] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => generateDateGrid(3), []);

  // Reset state when modal closes; preserve fields if user backs out mid-form.
  useEffect(() => {
    if (!open) {
      // Slight delay so the modal animates out before clearing.
      const t = setTimeout(() => {
        setStep("form");
        setSelectedDate(null);
        setSelectedTime(null);
        setError(null);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function handleFormNext(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setStep("slot");
  }

  async function handleSubmit() {
    if (!selectedDate || !selectedTime) {
      setError("Pick a date and time.");
      return;
    }
    setError(null);
    setStep("submitting");
    const { error: err } = await supabase.from("demo_bookings").insert({
      name:           name.trim(),
      email:          email.trim().toLowerCase(),
      agency_name:    agencyName.trim() || null,
      agency_size:    agencySize || null,
      requested_slot: combineDateTime(selectedDate, selectedTime),
      message:        message.trim() || null,
      source,
      user_agent:     navigator.userAgent.slice(0, 500),
      referrer:       document.referrer || null,
    });
    if (err) {
      setError(err.message || "Submission failed. Try again.");
      setStep("slot");
      return;
    }
    setStep("success");
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Book a demo"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl glass-strong shadow-2xl transition-all duration-300",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              {step === "success" ? "You're on the list" : "Book a private demo"}
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-shadow-soft">
              {step === "form"       && "Tell me about your agency"}
              {step === "slot"       && "Pick a date and time"}
              {step === "submitting" && "Locking in your slot…"}
              {step === "success"    && "Confirmed. See you soon."}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="p-6">
          {step === "form" && (
            <form onSubmit={handleFormNext} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="d-name">Your name <span className="text-destructive">*</span></Label>
                  <Input
                    id="d-name" value={name} onChange={(e) => setName(e.target.value)}
                    required
                    className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="d-email">Work email <span className="text-destructive">*</span></Label>
                  <Input
                    id="d-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-agency">Agency / IMO name</Label>
                <Input
                  id="d-agency" value={agencyName} onChange={(e) => setAgencyName(e.target.value)}
                  placeholder="e.g. JRM Enterprise Group"
                  className="border-white/10 bg-white/[0.03] focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-2">
                <Label>Agency size</Label>
                <div className="flex flex-wrap gap-2">
                  {AGENCY_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAgencySize(s)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        agencySize === s
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                      )}
                    >
                      {s} agents
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-msg">Anything I should know before the demo?</Label>
                <textarea
                  id="d-msg"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="e.g. moving off AgentView, carriers we work with, biggest pain point"
                  className="flex w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center justify-end">
                <Button type="submit">
                  Pick a time <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </form>
          )}

          {step === "slot" && (
            <div className="space-y-4">
              {/* Date grid */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Choose a weekday (Las Vegas time)
                </div>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {days.map((d) => {
                    const isSelected = selectedDate?.toDateString() === d.toDateString();
                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        onClick={() => { setSelectedDate(d); setSelectedTime(null); }}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          isSelected
                            ? "border-primary/40 bg-primary/15 text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.3)]"
                            : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                        )}
                      >
                        {fmtDate(d)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time grid */}
              {selectedDate && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {fmtDateLong(selectedDate)} · pick a 30-min slot
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                    {TIME_SLOTS.map((slot) => {
                      const isSelected = selectedTime === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setSelectedTime(slot)}
                          className={cn(
                            "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                            isSelected
                              ? "border-primary/40 bg-primary/15 text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.3)]"
                              : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                          )}
                        >
                          {formatTime(slot)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" onClick={() => setStep("form")}>
                  ← Back
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!selectedDate || !selectedTime}
                >
                  Confirm booking <Check className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === "submitting" && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Saving your booking…
            </div>
          )}

          {step === "success" && (
            <div className="space-y-4 py-2 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_hsl(150_70%_55%/0.4)]">
                <Check className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-semibold text-shadow-soft">
                  {selectedDate && selectedTime && (
                    <>
                      {fmtDateLong(selectedDate)} at {formatTime(selectedTime)} PT
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  I&apos;ll reach out to {email} within 24 hours to confirm and send the call link.
                </p>
              </div>
              <Button type="button" onClick={onClose} className="mt-2">
                Close
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
