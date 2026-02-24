import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";

interface AuditEvent {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  filters: {
    actions: string[];
    resource_types: string[];
  };
}

export default function AuditLogPage() {
  const api = useApi();
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", "50");
      if (actionFilter) params.set("action", actionFilter);
      if (resourceFilter) params.set("resource_type", resourceFilter);
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const result = await api.get<AuditLogResponse>(
        `/api/audit-log?${params.toString()}`
      );
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [api, page, actionFilter, resourceFilter, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatAction(action: string) {
    return action.replace(/_/g, " ");
  }

  function formatResourceType(type: string) {
    return type.replace(/_/g, " ");
  }

  return (
    <div className="px-8 py-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-warm-800">Audit Log</h1>
        <p className="text-warm-500 text-sm mt-1">
          HIPAA-compliant activity log. All reads and writes to protected health
          information are recorded here.
        </p>
        <div className="flex gap-4 mt-4 border-b border-warm-100 pb-px">
          <Link
            to="/settings/practice"
            className="text-sm font-medium text-warm-400 hover:text-warm-600 pb-2 px-1 transition-colors"
          >
            Profile
          </Link>
          <span className="text-sm font-medium text-teal-700 border-b-2 border-teal-600 pb-2 px-1">
            Audit Log
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-warm-100 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-warm-500 mb-1">
              Action
            </label>
            <select
              className="w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-700 bg-white"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All actions</option>
              {data?.filters.actions.map((a) => (
                <option key={a} value={a}>
                  {formatAction(a)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-warm-500 mb-1">
              Resource Type
            </label>
            <select
              className="w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-700 bg-white"
              value={resourceFilter}
              onChange={(e) => {
                setResourceFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {data?.filters.resource_types.map((rt) => (
                <option key={rt} value={rt}>
                  {formatResourceType(rt)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-warm-500 mb-1">
              Start Date
            </label>
            <input
              type="date"
              className="w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-700"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-warm-500 mb-1">
              End Date
            </label>
            <input
              type="date"
              className="w-full rounded-lg border border-warm-200 px-3 py-2 text-sm text-warm-700"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button
            onClick={() => {
              setActionFilter("");
              setResourceFilter("");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}
            className="px-4 py-2 text-sm text-warm-500 hover:text-warm-700 transition-colors"
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-warm-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-warm-400">Loading...</div>
        ) : !data || data.events.length === 0 ? (
          <div className="p-8 text-center text-warm-400">
            No audit events found
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-warm-100 bg-warm-50">
                    <th className="text-left px-4 py-3 font-medium text-warm-600">
                      Timestamp
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">
                      User
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">
                      Action
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">
                      Resource
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">
                      IP Address
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-warm-50 hover:bg-warm-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-warm-600 whitespace-nowrap">
                        {formatDate(event.created_at)}
                      </td>
                      <td className="px-4 py-3 text-warm-700 font-mono text-xs">
                        {event.user_id
                          ? event.user_id.slice(0, 12) + "..."
                          : "system"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700">
                          {formatAction(event.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-warm-700">
                        <span className="text-warm-600">
                          {formatResourceType(event.resource_type)}
                        </span>
                        {event.resource_id && (
                          <span className="text-warm-400 text-xs ml-1 font-mono">
                            {event.resource_id.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-warm-500 text-xs font-mono">
                        {event.ip_address || "-"}
                      </td>
                      <td className="px-4 py-3 text-warm-500 text-xs max-w-[200px] truncate">
                        {event.metadata
                          ? JSON.stringify(event.metadata)
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-warm-100 flex items-center justify-between">
              <p className="text-sm text-warm-500">
                Showing {(data.page - 1) * data.per_page + 1} to{" "}
                {Math.min(data.page * data.per_page, data.total)} of{" "}
                {data.total} events
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-warm-200 text-warm-600 hover:bg-warm-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="px-3 py-1.5 text-sm text-warm-600">
                  Page {data.page} of {data.total_pages}
                </span>
                <button
                  onClick={() =>
                    setPage(Math.min(data.total_pages, page + 1))
                  }
                  disabled={page >= data.total_pages}
                  className="px-3 py-1.5 text-sm rounded-lg border border-warm-200 text-warm-600 hover:bg-warm-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
