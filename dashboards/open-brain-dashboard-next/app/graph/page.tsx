import { requireSessionOrRedirect } from "@/lib/auth";
import { GraphExplorer } from "@/components/GraphExplorer";

export const dynamic = "force-dynamic";

function parseThoughtId(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseDepth(value: string | undefined): 1 | 2 {
  return value === "2" ? 2 : 1;
}

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSessionOrRedirect();
  const params = await searchParams;

  return (
    <GraphExplorer
      initialThoughtId={parseThoughtId(params.thought)}
      initialDepth={parseDepth(params.depth)}
    />
  );
}
