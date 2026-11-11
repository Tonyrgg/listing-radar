begin;
-- Keep the new scheduler's own telemetry bounded on the Free database.
-- Source records, import histories and other jobs' logs are not touched.
select cron.schedule('radar-read-model-log-retention','15 3 * * *',
 $$delete from cron.job_run_details where end_time < now()-interval '7 days' and jobid in (select jobid from cron.job where jobname in ('radar-read-model-refresh','radar-read-model-log-retention'))$$);
commit;
