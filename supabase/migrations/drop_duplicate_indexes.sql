-- supabase/migrations/drop_duplicate_indexes.sql
-- [DUBBELE-INDEX] Zeven paren die letterlijk hetzelfde zijn.
-- BoekBrug · 1 september 2026 · TOEGEPAST op de productiedatabase.
--
-- Zelfde tabel, zelfde kolommen, zelfde volgorde, zelfde uniciteit. Elke rij die wordt geschreven
-- onderhoudt ze allebei; elke lezing kan er maar één gebruiken. Weg is dus zuivere winst op
-- schrijven en verandert niets aan lezen.
--
-- DE REGEL BIJ HET KIEZEN, en waarom hij niet vanzelf spreekt: staat er één van de twee onder een
-- CONSTRAINT, dan blijft DIE staan — ook als de teller zegt dat de ander vaker is gebruikt. De
-- planner pakt de overgebleven index net zo goed; een index onder een constraint weghalen zou de
-- garantie zelf meenemen. Zo bleef acc_status_unique (0 scans) staan en ging
-- accountant_subject_status_unique (1905 scans) weg.
--
-- WAT ER BEWUST NIET BIJ ZIT: vier paren waarvan er één UNIQUE is en de ander niet. Die zien er in
-- een lijst hetzelfde uit en zijn het niet — de eerste versie van de zoekopdracht die dit vond
-- streepte "UNIQUE" weg en gaf ze als duplicaat op. Ze zijn niet inwisselbaar, dus blijven ze.

DROP INDEX IF EXISTS public.idx_accountant_clients_accountant;          -- = accountant_clients_accountant_idx
DROP INDEX IF EXISTS public.accountant_subject_status_unique;           -- = acc_status_unique (CONSTRAINT)
DROP INDEX IF EXISTS public.documents_folder_id_idx;                    -- = idx_documents_folder_id
DROP INDEX IF EXISTS public.documents_user_created;                     -- = idx_documents_user_created
DROP INDEX IF EXISTS public.documents_trashed_idx;                      -- = idx_documents_user_trashed
DROP INDEX IF EXISTS public.folders_user_id_idx;                        -- = idx_folders_user_id

-- Twee identieke UNIQUE-constraints op dezelfde twee kolommen. De garantie blijft volledig staan:
-- de overgebleven constraint legt precies dezelfde regel op.
ALTER TABLE public.draft_queue DROP CONSTRAINT IF EXISTS draft_queue_unique_accountant_client;
