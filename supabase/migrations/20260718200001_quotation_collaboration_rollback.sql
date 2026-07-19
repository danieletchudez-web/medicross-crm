-- Manual rollback for the collaborative quotation workflow.
-- Intentionally preserves generated business data by renaming tables instead of dropping them.

update public.crm_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{enabled}', 'false'::jsonb, true)
where key = 'quotation_collaboration';

-- To fully detach the feature after exporting its data, revoke API access:
revoke all on public.quotation_items from authenticated;
revoke all on public.quotation_item_costs from authenticated;
revoke all on public.quotation_validations from authenticated;
revoke all on public.quotation_validation_items from authenticated;
revoke all on public.quotation_attachments from authenticated;
revoke all on public.quotation_activity_log from authenticated;
revoke all on public.quotation_comments from authenticated;
revoke all on public.quotation_item_reviews from authenticated;

-- cotizaciones.renglones, existing states and PDF files remain untouched.
-- Do not drop tables or the quotation-files bucket until retention has been reviewed.
