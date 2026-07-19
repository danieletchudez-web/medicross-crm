-- Verificación de estructura. Es de sólo lectura y puede ejecutarse tras la migración.
select key, value->>'enabled' as enabled
from public.crm_settings
where key = 'quotation_collaboration';

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name = 'department';

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'quotation_items', 'quotation_item_costs', 'quotation_validations',
    'quotation_validation_items', 'quotation_attachments',
    'quotation_activity_log', 'quotation_comments', 'quotation_item_reviews'
  )
order by table_name;

select id, name, public
from storage.buckets
where id = 'quotation-files';

select * from public.quotation_workflow_metrics limit 5;
