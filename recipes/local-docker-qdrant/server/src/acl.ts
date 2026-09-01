import type { QdrantFilter } from "./qdrant.js";
import type { Identity } from "./identity.js";

// ACL filter composition is the single enforcement point.
// If you add a new read handler, you MUST call buildAclFilter().
export function buildAclFilter(
  identity: Identity,
  userFilter?: QdrantFilter
): QdrantFilter {
  return {
    must: [
      ...(userFilter?.must ?? []),
      {
        should: [
          { key: "owner_id", match: { value: identity.owner_id } },
          { key: "visibility", match: { value: "shared" } },
        ],
      },
    ],
  };
}

export function buildOwnerOnlyFilter(identity: Identity): QdrantFilter {
  return {
    must: [{ key: "owner_id", match: { value: identity.owner_id } }],
  };
}
