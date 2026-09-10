create or replace function public.match_thoughts_with_health(
  query_embedding vector(1536),
  match_threshold float default 0.0,
  match_count int default 10,
  filter jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  results jsonb := '[]'::jsonb;
  returned_count integer := 0;
  status text := 'OK';
  reason text := 'recall_source_returned_results';
begin
  select coalesce(jsonb_agg(to_jsonb(mt)), '[]'::jsonb)
  into results
  from public.match_thoughts(query_embedding, match_threshold, match_count, filter) as mt;

  returned_count := jsonb_array_length(results);

  if returned_count = 0 then
    status := 'DEGRADED';
    reason := 'recall_source_returned_no_rows';
  end if;

  return jsonb_build_object(
    'source_health', jsonb_build_object(
      'status', status,
      'reason', reason,
      'requested_count', match_count,
      'returned_count', returned_count
    ),
    'results', results
  );
exception
  when others then
    return jsonb_build_object(
      'source_health', jsonb_build_object(
        'status', 'UNAVAILABLE',
        'reason', SQLERRM,
        'requested_count', match_count,
        'returned_count', 0
      ),
      'results', '[]'::jsonb
    );
end;
$$;
