import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Calendar, Clock, Check, X, ChevronLeft, ChevronRight, ArrowRight, Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fireSideBursts } from "@/lib/confetti";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  source?: string;
};

const AGENCY_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;
type AgencySize = (typeof AGENCY_SIZES)[number];

/** 30-min slots, 9:00 AM through 5:30 PM Pacific. */
const TIME_SLOTS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
];

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

function formatTime(slot: string): string {
  const [h, m] = slot.split(":").map(Number);
  const hr = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function combineDateTime(date: Date, timeSlot: string): string {
  const [hh, mm] = timeSlot.split(":").map(Number);
  const localDate = new Date(date);
  localDate.setHours(hh, mm, 0, 0);
  const tzOffsetMs = (() => {
    const utcDate = new Date(localDate.toLocaleString("en-US", { timeZone: "UTC" }));
    const pstDate = new Date(localDate.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    return utcDate.getTime() - pstDate.getTime();
  })();
  return new Date(localDate.getTime() + tzOffsetMs).toISOString();
}

/**
 * Build the 6×7 month grid for the given month. Padded with leading days
 * from the previous month and trailing days from the next month so every
 * week row is full. Returns Date objects (always at midnight local time).
 */
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay(); // 0 Sun … 6 Sat
  const start = new Date(year, month, 1 - firstWeekday);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    d.setHours(0, 0, 0, 0);
    cells.push(d);
  }
  return cells;
}

function CalendarStep({
  selectedDate, selectedTime, onSelectDate, onSelectTime, onNext,
}: {
  selectedDate: Date | null;
  selectedTime: string | null;
  onSelectDate: (d: Date) => void;
  onSelectTime: (t: string) => void;
  onNext: () => void;
}) {
  const today = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0); return t;
  }, []);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = new Date(today);
    d.setDate(1);
    return d;
  });

  const cells = useMemo(
    () => buildMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()),
    [viewMonth],
  );

  function prevMonth() {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() - 1);
    setViewMonth(d);
  }
  function nextMonth() {
    const d = new Date(viewMonth);
    d.setMonth(d.getMonth() + 1);
    setViewMonth(d);
  }

  const minDate = today;
  const maxDate = new Date(today); maxDate.setMonth(maxDate.getMonth() + 2);

  function isSelectable(d: Date): boolean {
    if (d < minDate) return false;
    if (d > maxDate) return false;
    if (d.getDay() === 0 || d.getDay() === 6) return false; // weekday only
    return true;
  }

  return (
    <div className="space-y-5">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold tracking-tight text-shadow-soft">
          {fmtMonthYear(viewMonth)}
        </p>
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Calendar grid */}
      <div>
        <div className="mb-1.5 grid grid-cols-7 text-center">
          {WEEKDAY_HEADERS.map((d, i) => (
            <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const inMonth = d.getMonth() === viewMonth.getMonth();
            const selectable = isSelectable(d);
            const isSelected = selectedDate && sameDay(d, selectedDate);
            const isToday = sameDay(d, today);
            return (
              <button
                key={d.toISOString()}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && onSelectDate(d)}
                className={cn(
                  "relative aspect-square rounded-lg text-sm font-medium transition-all duration-150",
                  !inMonth && "opacity-30",
                  !selectable && "cursor-not-allowed text-muted-foreground/50",
                  selectable && !isSelected && "text-foreground hover:bg-white/[0.06]",
                  isSelected && "bg-primary/15 text-primary ring-1 ring-primary/40 shadow-[0_0_20px_hsl(38_92%_60%/0.35)]",
                  isToday && !isSelected && "ring-1 ring-white/15",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time slots */}
      {selectedDate && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {fmtDateLong(selectedDate)} · pick a 30-min slot · Las Vegas time
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-1.5">
            {TIME_SLOTS.map((slot) => {
              const isSelected = selectedTime === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => onSelectTime(slot)}
                  className={cn(
                    "rounded-lg border px-2 py-3 text-sm font-medium transition-all sm:py-2 sm:text-xs",
                    isSelected
                      ? "border-primary/40 bg-primary/15 text-primary shadow-[0_0_16px_hsl(38_92%_60%/0.3)]"
                      : "border-white/10 bg-white/[0.02] text-muted-foreground active:bg-white/[0.08] sm:hover:bg-white/[0.06] sm:hover:text-foreground",
                  )}
                >
                  {formatTime(slot)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end pt-1">
        <Button
          type="button"
          onClick={onNext}
          disabled={!selectedDate || !selectedTime}
          className="shadow-[0_0_24px_hsl(38_92%_60%/0.35)]"
        >
          Continue <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function FormStep({
  selectedDate, selectedTime, onBack, onSubmit, submitting, error,
  name, setName, email, setEmail, agencyName, setAgencyName,
  agencySize, setAgencySize, message, setMessage,
}: {
  selectedDate: Date;
  selectedTime: string;
  onBack: () => void;
  onSubmit: (e: FormEvent) => void;
  submitting: boolean;
  error: string | null;
  name: string; setName: (s: string) => void;
  email: string; setEmail: (s: string) => void;
  agencyName: string; setAgencyName: (s: string) => void;
  agencySize: AgencySize | ""; setAgencySize: (s: AgencySize | "") => void;
  message: string; setMessage: (s: string) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Slot recap pill */}
      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.08] px-3 py-2.5">
        <Calendar className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-shadow-soft">
          {fmtDateShort(selectedDate)} · {formatTime(selectedTime)} PT
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          You can change this on the previous step
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="d-name">Your name <span className="text-destructive">*</span></Label>
          <Input
            id="d-name" value={name} onChange={(e) => setName(e.target.value)}
            required autoFocus
            className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-email">Work email <span className="text-destructive">*</span></Label>
          <Input
            id="d-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required inputMode="email" autoCapitalize="none" autoComplete="email"
            className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="d-agency">Agency / IMO name</Label>
        <Input
          id="d-agency" value={agencyName} onChange={(e) => setAgencyName(e.target.value)}
          placeholder="e.g. JRM Enterprise Group"
          className="h-11 border-white/10 bg-white/[0.03] focus-visible:ring-primary sm:h-10"
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
                "rounded-full border px-3.5 py-2 text-sm font-medium transition-colors sm:py-1 sm:text-xs",
                agencySize === s
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/10 bg-white/[0.02] text-muted-foreground active:bg-white/[0.08] sm:hover:bg-white/[0.06] sm:hover:text-foreground",
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

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          className="shadow-[0_0_24px_hsl(38_92%_60%/0.35)]"
        >
          {submitting ? "Booking…" : <>Confirm booking <Check className="ml-1.5 h-4 w-4" /></>}
        </Button>
      </div>
    </form>
  );
}

function ThankYouStep({
  name, email, selectedDate, selectedTime, onClose,
}: {
  name: string;
  email: string;
  selectedDate: Date;
  selectedTime: string;
  onClose: () => void;
}) {
  // Fire confetti on mount.
  useEffect(() => {
    const t = setTimeout(() => fireSideBursts({ bursts: 4, perSide: 70 }), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-5 py-2 text-center">
      <div className="relative mx-auto h-20 w-20">
        {/* Concentric glow rings */}
        <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />
        <div className="absolute inset-2 rounded-full bg-emerald-400/15" />
        <div className="absolute inset-4 flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/20 text-emerald-300 shadow-[0_0_36px_hsl(150_70%_55%/0.6)]">
          <Check className="h-9 w-9" />
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          You&apos;re booked
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-shadow-hero">
          Thank you, <span className="gold-shimmer">{name.split(" ")[0] || name}</span>.
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">
          You&apos;re locked in for <span className="font-semibold text-foreground">
            {fmtDateLong(selectedDate)}
          </span> at <span className="font-semibold text-foreground">
            {formatTime(selectedTime)} PT
          </span>.
        </p>
      </div>

      {/* Detail card */}
      <div className="mx-auto max-w-sm rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left text-xs">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold text-foreground">What happens next</p>
            <p className="mt-1 text-muted-foreground">
              I&apos;ll send a calendar invite + Google Meet link to <span className="font-medium text-foreground">{email}</span> within 24 hours.
              The demo runs 45 minutes. Live, on your screen and mine.
            </p>
          </div>
        </div>
      </div>

      <Button type="button" onClick={onClose} size="lg">
        Close
      </Button>
    </div>
  );
}

export function DemoBookingModal({ open, onClose, source = "homepage" }: Props) {
  const [step, setStep] = useState<"calendar" | "form" | "thanks">("calendar");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [agencySize, setAgencySize] = useState<AgencySize | "">("");
  const [message, setMessage] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when modal closes; slight delay so close animation plays first.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep("calendar");
        setName("");
        setEmail("");
        setAgencyName("");
        setAgencySize("");
        setMessage("");
        setSelectedDate(null);
        setSelectedTime(null);
        setError(null);
        setSubmitting(false);
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedDate || !selectedTime) {
      setError("Pick a date and time on the previous step.");
      return;
    }
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
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
    setSubmitting(false);
    if (err) {
      setError(err.message || "Submission failed. Try again.");
      return;
    }
    setStep("thanks");
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

      {/* Modal — full-screen on mobile, centered dialog on desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Book a private demo"
        className={cn(
          "fixed inset-0 z-50 flex flex-col glass-strong shadow-2xl transition-all duration-300",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          open
            ? "translate-y-0 opacity-100 sm:scale-100"
            : "pointer-events-none translate-y-4 opacity-0 sm:translate-y-0 sm:scale-95",
        )}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              Book a private demo
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-shadow-soft">
              {step === "calendar" && "Pick a date and time"}
              {step === "form"     && "Tell me about your agency"}
              {step === "thanks"   && "Confirmed"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicator */}
            {step !== "thanks" && (
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-6 rounded-full transition-colors",
                  step === "calendar" ? "bg-primary" : "bg-white/15")} />
                <span className={cn("h-1.5 w-6 rounded-full transition-colors",
                  step === "form" ? "bg-primary" : "bg-white/15")} />
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {step === "calendar" && (
            <CalendarStep
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onSelectDate={(d) => { setSelectedDate(d); setSelectedTime(null); }}
              onSelectTime={setSelectedTime}
              onNext={() => setStep("form")}
            />
          )}

          {step === "form" && selectedDate && selectedTime && (
            <FormStep
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onBack={() => setStep("calendar")}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={error}
              name={name} setName={setName}
              email={email} setEmail={setEmail}
              agencyName={agencyName} setAgencyName={setAgencyName}
              agencySize={agencySize} setAgencySize={setAgencySize}
              message={message} setMessage={setMessage}
            />
          )}

          {step === "thanks" && selectedDate && selectedTime && (
            <ThankYouStep
              name={name}
              email={email}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </>
  );
}
