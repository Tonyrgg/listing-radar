-- Restore from this view or the corrected backup, not an earlier diagnostic
-- export whose timestamp strings were normalized by the export tool.
create or replace view radar_archive.retired_matching_effective as
select distinct on(source,table_name,row_id)source,dataset,table_name,row_id,payload,digest,copied_at
from radar_archive.retired_rows
where dataset='retired-matching-2026-11-10'
 or(dataset='retired-components-raw-2026-11-10'and table_name='snapshot_components')
order by source,table_name,row_id,dataset asc;
