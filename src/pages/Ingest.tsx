import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { ParsedCsv } from "@/lib/ingest-csv-parser";
import type { ColumnMap, StatusMap } from "@/lib/ingest-row-canonicalize";
import type { PreviewResult, PreviewRow } from "@/hooks/useIngestPreview";
import type { CommitResult } from "@/hooks/useIngestCommit";
import { IngestUploadStep } from "@/components/ingest/IngestUploadStep";
import { IngestColumnMapStep } from "@/components/ingest/IngestColumnMapStep";
import { IngestStatusMapStep } from "@/components/ingest/IngestStatusMapStep";
import { IngestPreviewStep } from "@/components/ingest/IngestPreviewStep";
import { IngestResolveStep } from "@/components/ingest/IngestResolveStep";
import { IngestApplyStep } from "@/components/ingest/IngestApplyStep";
import { IngestSummaryStep } from "@/components/ingest/IngestSummaryStep";

type Step = "upload" | "columns" | "status" | "preview" | "resolve" | "apply" | "summary";

export type DupAction = "create_duplicates" | "skip_duplicates" | "cancel";

export function IngestPage() {
  const { isOwner } = useAuth();

  const [step, setStep] = useState<Step>("upload");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap>({});
  const [statusMap, setStatusMap] = useState<StatusMap>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewResults, setPreviewResults] = useState<PreviewResult[]>([]);
  const [overriddenRows, setOverriddenRows] = useState<PreviewRow[]>([]);
  const [dupAction, setDupAction] = useState<DupAction>("skip_duplicates");
  const [commitResults, setCommitResults] = useState<CommitResult[]>([]);

  if (!isOwner) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        Carrier ingest is owner-only.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Carrier ingest</h1>
        <p className="text-sm text-muted-foreground">
          Upload a carrier statement CSV. Map columns, resolve any agent or product mismatches,
          then commit.
        </p>
        <StepBar current={step} />
      </header>

      {step === "upload" && (
        <IngestUploadStep
          onLoaded={(parsed) => {
            setCsv(parsed);
            setColumnMap({});
            setStep("columns");
          }}
        />
      )}

      {step === "columns" && csv && (
        <IngestColumnMapStep
          csv={csv}
          columnMap={columnMap}
          onChange={setColumnMap}
          onBack={() => setStep("upload")}
          onNext={() => setStep("status")}
        />
      )}

      {step === "status" && csv && (
        <IngestStatusMapStep
          csv={csv}
          columnMap={columnMap}
          statusMap={statusMap}
          onChange={setStatusMap}
          onBack={() => setStep("columns")}
          onNext={() => setStep("preview")}
        />
      )}

      {step === "preview" && csv && (
        <IngestPreviewStep
          csv={csv}
          columnMap={columnMap}
          statusMap={statusMap}
          dupAction={dupAction}
          onDupActionChange={setDupAction}
          onPreviewLoaded={(rows, results) => {
            setPreviewRows(rows);
            setPreviewResults(results);
          }}
          onBack={() => setStep("status")}
          onNext={() => setStep("resolve")}
        />
      )}

      {step === "resolve" && (
        <IngestResolveStep
          rows={previewRows}
          results={previewResults}
          dupAction={dupAction}
          onResolved={(rows) => {
            setOverriddenRows(rows);
            setStep("apply");
          }}
          onBack={() => setStep("preview")}
        />
      )}

      {step === "apply" && (
        <IngestApplyStep
          rows={overriddenRows}
          onDone={(results) => {
            setCommitResults(results);
            setStep("summary");
          }}
        />
      )}

      {step === "summary" && (
        <IngestSummaryStep
          results={commitResults}
          onStartOver={() => {
            setStep("upload");
            setCsv(null);
            setColumnMap({});
            setStatusMap({});
            setPreviewRows([]);
            setPreviewResults([]);
            setOverriddenRows([]);
            setCommitResults([]);
          }}
        />
      )}
    </div>
  );
}

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "columns", label: "Map columns" },
  { id: "status", label: "Status mapping" },
  { id: "preview", label: "Preview" },
  { id: "resolve", label: "Resolve" },
  { id: "apply", label: "Apply" },
  { id: "summary", label: "Summary" },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          className={
            i === idx
              ? "rounded bg-primary px-2 py-1 text-primary-foreground"
              : i < idx
              ? "rounded bg-muted px-2 py-1 text-muted-foreground"
              : "rounded border px-2 py-1 text-muted-foreground"
          }
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}
