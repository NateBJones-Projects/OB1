import { requireSessionOrRedirect } from "@/lib/auth";
import { KanbanBoard } from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";


export default async function KanbanPage() {
  await requireSessionOrRedirect();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Workflow</h1>
        <p className="text-text-secondary text-sm">
          Track tasks and ideas through your workflow
        </p>
      </div>
      <KanbanBoard />
    </div>
  );
}
