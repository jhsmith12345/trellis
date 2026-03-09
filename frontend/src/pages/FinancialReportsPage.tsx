import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MonthlyCollection {
  year: number;
  month: number;
  billed: number;
  collected: number;
  outstanding: number;
}

interface PayerCollection {
  payer_name: string;
  billed: number;
  collected: number;
  count: number;
}

interface CptCollection {
  cpt_code: string;
  cpt_description: string;
  count: number;
  billed: number;
  collected: number;
}

interface AgingBucket {
  amount: number;
  count: number;
}

interface ArAging {
  current: AgingBucket;
  days_31_60: AgingBucket;
  days_61_90: AgingBucket;
  days_90_plus: AgingBucket;
}

interface PayerMix {
  payer_name: string;
  percentage: number;
  count: number;
}

interface DenialRate {
  total_claims: number;
  denied_claims: number;
  rate_percent: number;
}

interface AvgDaysByPayer {
  payer_name: string;
  avg_days: number;
}

interface YtdSummary {
  total_billed: number;
  total_collected: number;
  total_outstanding: number;
  total_claims: number;
  avg_per_claim: number;
}

interface ReportsData {
  collections_by_month: MonthlyCollection[];
  collections_by_payer: PayerCollection[];
  collections_by_cpt: CptCollection[];
  ar_aging: ArAging;
  payer_mix: PayerMix[];
  denial_rate: DenialRate;
  avg_days_to_payment_by_payer: AvgDaysByPayer[];
  ytd_summary: YtdSummary;
  date_range: { from_date: string; to_date: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCurrencyExact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Colors for the donut chart
const DONUT_COLORS = [
  "#0d9488", // teal-600
  "#0891b2", // cyan-600
  "#2563eb", // blue-600
  "#7c3aed", // violet-600
  "#db2777", // pink-600
  "#9ca3af", // gray-400 (Other)
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-warm-100 p-5">
      <p className="text-sm text-warm-500 font-medium">{label}</p>
      <p className="text-2xl font-bold text-warm-800 mt-1">{value}</p>
      {subtitle && (
        <p className="text-xs text-warm-400 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function MonthlyRevenueChart({ data }: { data: MonthlyCollection[] }) {
  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-warm-400 text-sm">
        No data available for this date range.
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => Math.max(d.billed, d.collected)), 1);

  // SVG chart dimensions
  const chartWidth = 800;
  const chartHeight = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const stepX = data.length > 1 ? plotWidth / (data.length - 1) : plotWidth / 2;

  const billedPoints = data.map((d, i) => {
    const x = padding.left + (data.length > 1 ? i * stepX : plotWidth / 2);
    const y = padding.top + plotHeight - (d.billed / maxVal) * plotHeight;
    return `${x},${y}`;
  });

  const collectedPoints = data.map((d, i) => {
    const x = padding.left + (data.length > 1 ? i * stepX : plotWidth / 2);
    const y = padding.top + plotHeight - (d.collected / maxVal) * plotHeight;
    return `${x},${y}`;
  });

  // Fill area under billed
  const billedArea =
    `M${padding.left + (data.length > 1 ? 0 : plotWidth / 2)},${padding.top + plotHeight} ` +
    billedPoints.map((p) => `L${p}`).join(" ") +
    ` L${padding.left + (data.length > 1 ? (data.length - 1) * stepX : plotWidth / 2)},${padding.top + plotHeight} Z`;

  const collectedArea =
    `M${padding.left + (data.length > 1 ? 0 : plotWidth / 2)},${padding.top + plotHeight} ` +
    collectedPoints.map((p) => `L${p}`).join(" ") +
    ` L${padding.left + (data.length > 1 ? (data.length - 1) * stepX : plotWidth / 2)},${padding.top + plotHeight} Z`;

  // Y-axis grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    y: padding.top + plotHeight - pct * plotHeight,
    label: formatCurrency(pct * maxVal),
  }));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full min-w-[500px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={g.y}
              x2={chartWidth - padding.right}
              y2={g.y}
              stroke="#e7e5e4"
              strokeWidth="1"
              strokeDasharray={i === 0 ? "0" : "4,4"}
            />
            <text
              x={padding.left - 8}
              y={g.y + 4}
              textAnchor="end"
              className="text-[10px] fill-warm-400"
            >
              {g.label}
            </text>
          </g>
        ))}

        {/* Area fills */}
        <path d={billedArea} fill="#99f6e4" opacity="0.3" />
        <path d={collectedArea} fill="#0d9488" opacity="0.15" />

        {/* Lines */}
        <polyline
          points={billedPoints.join(" ")}
          fill="none"
          stroke="#99f6e4"
          strokeWidth="2.5"
        />
        <polyline
          points={collectedPoints.join(" ")}
          fill="none"
          stroke="#0d9488"
          strokeWidth="2.5"
        />

        {/* Data points */}
        {data.map((d, i) => {
          const x = padding.left + (data.length > 1 ? i * stepX : plotWidth / 2);
          const yB = padding.top + plotHeight - (d.billed / maxVal) * plotHeight;
          const yC = padding.top + plotHeight - (d.collected / maxVal) * plotHeight;
          return (
            <g key={i}>
              <circle cx={x} cy={yB} r="3" fill="#99f6e4" stroke="#fff" strokeWidth="1.5" />
              <circle cx={x} cy={yC} r="3" fill="#0d9488" stroke="#fff" strokeWidth="1.5" />
            </g>
          );
        })}

        {/* X-axis labels */}
        {data.map((d, i) => {
          const x = padding.left + (data.length > 1 ? i * stepX : plotWidth / 2);
          return (
            <text
              key={i}
              x={x}
              y={chartHeight - 8}
              textAnchor="middle"
              className="text-[10px] fill-warm-400"
            >
              {MONTH_NAMES[d.month]} {String(d.year).slice(2)}
            </text>
          );
        })}
      </svg>
      {/* Legend */}
      <div className="flex items-center gap-6 mt-3 justify-center text-xs text-warm-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-teal-200 inline-block" />
          Billed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-teal-600 inline-block" />
          Collected
        </span>
      </div>
    </div>
  );
}

function PayerCollectionsTable({ data }: { data: PayerCollection[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-warm-400 py-4 text-center">No payer data available.</p>;
  }
  const maxCollected = Math.max(...data.map((d) => d.collected), 1);

  return (
    <div className="space-y-3">
      {data.map((p) => {
        const rate = p.billed > 0 ? (p.collected / p.billed) * 100 : 0;
        const rateColor =
          rate >= 90
            ? "text-green-600 bg-green-50"
            : rate >= 70
              ? "text-amber-600 bg-amber-50"
              : "text-red-600 bg-red-50";
        const barWidth = (p.collected / maxCollected) * 100;

        return (
          <div key={p.payer_name} className="group">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-warm-700 truncate max-w-[200px]">
                {p.payer_name}
              </span>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-warm-400">{p.count} claims</span>
                <span className="text-warm-600 font-medium">
                  {formatCurrencyExact(p.collected)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${rateColor}`}
                >
                  {rate.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="h-2 bg-warm-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 rounded-full transition-all duration-500"
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CptTable({ data }: { data: CptCollection[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-warm-400 py-4 text-center">No CPT data available.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-warm-100">
            <th className="text-left py-2 px-3 text-warm-500 font-medium">CPT</th>
            <th className="text-left py-2 px-3 text-warm-500 font-medium">Description</th>
            <th className="text-right py-2 px-3 text-warm-500 font-medium">Count</th>
            <th className="text-right py-2 px-3 text-warm-500 font-medium">Billed</th>
            <th className="text-right py-2 px-3 text-warm-500 font-medium">Collected</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.cpt_code} className="border-b border-warm-50 hover:bg-warm-50/50">
              <td className="py-2.5 px-3 font-mono text-warm-700 font-medium">{c.cpt_code}</td>
              <td className="py-2.5 px-3 text-warm-600 truncate max-w-[250px]">
                {c.cpt_description || "--"}
              </td>
              <td className="py-2.5 px-3 text-right text-warm-600">{c.count}</td>
              <td className="py-2.5 px-3 text-right text-warm-600">
                {formatCurrencyExact(c.billed)}
              </td>
              <td className="py-2.5 px-3 text-right text-warm-800 font-medium">
                {formatCurrencyExact(c.collected)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArAgingDisplay({ data }: { data: ArAging }) {
  const buckets = [
    { key: "current", label: "0-30 Days", color: "bg-green-500", lightColor: "bg-green-50", textColor: "text-green-700", data: data.current },
    { key: "days_31_60", label: "31-60 Days", color: "bg-amber-400", lightColor: "bg-amber-50", textColor: "text-amber-700", data: data.days_31_60 },
    { key: "days_61_90", label: "61-90 Days", color: "bg-orange-500", lightColor: "bg-orange-50", textColor: "text-orange-700", data: data.days_61_90 },
    { key: "days_90_plus", label: "90+ Days", color: "bg-red-500", lightColor: "bg-red-50", textColor: "text-red-700", data: data.days_90_plus },
  ];

  const totalAmount = buckets.reduce((s, b) => s + b.data.amount, 0);

  return (
    <div>
      {/* Stacked bar */}
      {totalAmount > 0 && (
        <div className="h-6 rounded-full overflow-hidden flex mb-6">
          {buckets.map((b) => {
            const pct = totalAmount > 0 ? (b.data.amount / totalAmount) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={b.key}
                className={`${b.color} transition-all duration-500`}
                style={{ width: `${pct}%` }}
                title={`${b.label}: ${formatCurrencyExact(b.data.amount)}`}
              />
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={`${b.lightColor} rounded-xl p-4 text-center`}
          >
            <p className={`text-xs font-medium ${b.textColor} opacity-80`}>
              {b.label}
            </p>
            <p className={`text-lg font-bold ${b.textColor} mt-1`}>
              {formatCurrency(b.data.amount)}
            </p>
            <p className={`text-xs ${b.textColor} opacity-60 mt-0.5`}>
              {b.data.count} claim{b.data.count !== 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayerMixDonut({ data }: { data: PayerMix[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-warm-400 py-4 text-center">No payer mix data available.</p>;
  }

  // Top 5 + Other
  const sorted = [...data].sort((a, b) => b.percentage - a.percentage);
  const top5 = sorted.slice(0, 5);
  const otherPct = sorted.slice(5).reduce((s, p) => s + p.percentage, 0);
  const otherCount = sorted.slice(5).reduce((s, p) => s + p.count, 0);
  const display = [...top5];
  if (otherPct > 0) {
    display.push({ payer_name: "Other", percentage: Math.round(otherPct * 10) / 10, count: otherCount });
  }

  // Build conic gradient
  let cumPct = 0;
  const stops: string[] = [];
  display.forEach((d, i) => {
    const color = DONUT_COLORS[i % DONUT_COLORS.length];
    stops.push(`${color} ${cumPct}%`);
    cumPct += d.percentage;
    stops.push(`${color} ${cumPct}%`);
  });

  const gradient = `conic-gradient(${stops.join(", ")})`;

  return (
    <div className="flex flex-col md:flex-row items-center gap-8">
      {/* Donut */}
      <div className="relative w-44 h-44 shrink-0">
        <div
          className="w-full h-full rounded-full"
          style={{ background: gradient }}
        />
        <div className="absolute inset-5 bg-white rounded-full flex items-center justify-center">
          <div className="text-center">
            <p className="text-xs text-warm-400">Total</p>
            <p className="text-sm font-bold text-warm-700">
              {data.reduce((s, d) => s + d.count, 0)}
            </p>
            <p className="text-xs text-warm-400">claims</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-2 flex-1">
        {display.map((d, i) => (
          <div key={d.payer_name} className="flex items-center gap-3">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="text-sm text-warm-700 flex-1 truncate">
              {d.payer_name}
            </span>
            <span className="text-sm font-medium text-warm-600">
              {d.percentage.toFixed(1)}%
            </span>
            <span className="text-xs text-warm-400">
              ({d.count})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvgDaysTable({ data }: { data: AvgDaysByPayer[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-warm-400 py-4 text-center">No payment timing data available.</p>;
  }

  const maxDays = Math.max(...data.map((d) => d.avg_days), 1);

  return (
    <div className="space-y-3">
      {data.map((d) => {
        const barWidth = (d.avg_days / maxDays) * 100;
        const barColor =
          d.avg_days <= 21
            ? "bg-green-500"
            : d.avg_days <= 45
              ? "bg-amber-400"
              : "bg-red-500";

        return (
          <div key={d.payer_name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-warm-700 truncate max-w-[250px]">
                {d.payer_name}
              </span>
              <span className="text-sm font-medium text-warm-600">
                {d.avg_days} days
              </span>
            </div>
            <div className="h-2 bg-warm-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor} rounded-full transition-all duration-500`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DenialRateCard({ data }: { data: DenialRate }) {
  const rateColor =
    data.rate_percent <= 5
      ? "text-green-600"
      : data.rate_percent <= 15
        ? "text-amber-600"
        : "text-red-600";

  return (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <p className={`text-4xl font-bold ${rateColor}`}>
          {data.rate_percent.toFixed(1)}%
        </p>
        <p className="text-xs text-warm-400 mt-1">Denial Rate</p>
      </div>
      <div className="border-l border-warm-100 pl-6 space-y-1">
        <p className="text-sm text-warm-600">
          <span className="font-medium text-warm-800">{data.total_claims}</span> total claims
        </p>
        <p className="text-sm text-warm-600">
          <span className="font-medium text-red-600">{data.denied_claims}</span> denied / stale
        </p>
        <p className="text-xs text-warm-400 mt-2">
          Based on claims outstanding 45+ days after submission
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-warm-100 p-6 ${className}`}>
      <h2 className="text-lg font-semibold text-warm-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function FinancialReportsPage() {
  const api = useApi();
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date range state
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const [fromDate, setFromDate] = useState(
    defaultFrom.toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ReportsData>(
        `/billing/reports?from_date=${fromDate}&to_date=${toDate}`
      );
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [api, fromDate, toDate]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              to="/billing"
              className="text-warm-400 hover:text-warm-600 transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
            <h1 className="font-display text-2xl font-bold text-warm-800">
              Financial Reports
            </h1>
          </div>
          <p className="text-sm text-warm-500">
            Revenue analytics and billing performance.
          </p>
        </div>

        {/* Date range picker */}
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-warm-200 rounded-lg px-3 py-2 text-warm-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
          />
          <span className="text-warm-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-warm-200 rounded-lg px-3 py-2 text-warm-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400"
          />
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 mb-6">
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-6">
          {/* YTD Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <SummaryCard
              label="Total Billed"
              value={formatCurrency(data.ytd_summary.total_billed)}
            />
            <SummaryCard
              label="Total Collected"
              value={formatCurrency(data.ytd_summary.total_collected)}
            />
            <SummaryCard
              label="Outstanding"
              value={formatCurrency(data.ytd_summary.total_outstanding)}
            />
            <SummaryCard
              label="Total Claims"
              value={data.ytd_summary.total_claims.toLocaleString()}
            />
            <SummaryCard
              label="Avg Per Claim"
              value={formatCurrencyExact(data.ytd_summary.avg_per_claim)}
            />
          </div>

          {/* Monthly Revenue Trend */}
          <Section title="Monthly Revenue Trend">
            <MonthlyRevenueChart data={data.collections_by_month} />
          </Section>

          {/* Two-column layout for payer and CPT */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Collections by Payer */}
            <Section title="Collections by Payer">
              <PayerCollectionsTable data={data.collections_by_payer} />
            </Section>

            {/* Payer Mix */}
            <Section title="Payer Mix">
              <PayerMixDonut data={data.payer_mix} />
            </Section>
          </div>

          {/* A/R Aging */}
          <Section title="Accounts Receivable Aging">
            <ArAgingDisplay data={data.ar_aging} />
          </Section>

          {/* Collections by CPT */}
          <Section title="Revenue by CPT Code">
            <CptTable data={data.collections_by_cpt} />
          </Section>

          {/* Two-column: Avg Days + Denial Rate */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Avg Days to Payment */}
            <Section title="Avg Days to Payment by Payer">
              <AvgDaysTable data={data.avg_days_to_payment_by_payer} />
            </Section>

            {/* Denial Rate */}
            <Section title="Denial Rate">
              <DenialRateCard data={data.denial_rate} />
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
