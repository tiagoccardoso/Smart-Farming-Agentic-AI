-- Automatically create a client profile when a Supabase Auth user signs up.
-- The application sends full_name and phone in raw_user_meta_data during registration.

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    'client'
  )
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name),
        phone = coalesce(excluded.phone, public.profiles.phone);

  return new;
end;
$$;

drop trigger if exists create_profile_after_auth_signup on auth.users;
create trigger create_profile_after_auth_signup
after insert on auth.users
for each row
execute function public.handle_new_auth_user_profile();
