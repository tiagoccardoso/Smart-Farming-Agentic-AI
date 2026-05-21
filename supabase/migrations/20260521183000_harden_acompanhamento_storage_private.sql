begin;

update storage.buckets
set public = false
where id = 'acompanhamento-anexos';

commit;
