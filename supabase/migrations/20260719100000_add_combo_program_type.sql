-- Enum values must be committed before they are referenced by later migrations.
alter type public.program_type add value if not exists 'combo';
