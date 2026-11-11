begin;
create extension if not exists pg_cron;
select cron.schedule('radar-read-model-refresh','* * * * *','select public.refresh_radar_read_model()');
commit;
