-- Red-button reports may arrive without a screenshot (CEO 13 Nov 00:55Z, Q-ENG-FEEDBACK-400). Additive/relaxing. STAGING ONLY until Nami's yes.
-- Rollback (only while no row has a null path): delete from public.feedback where screenshot_path is null (after pull); alter table public.feedback alter column screenshot_path set not null;
alter table public.feedback alter column screenshot_path drop not null;
