-- One canonical form for every stored phone number (TASK-3.12, M-3).
--
-- +998901234567, 998901234567 and 901234567 are the same number and were three
-- different accounts: the login lookup is an exact string match on a unique
-- column, so a driver who registered one way could not sign in the other.
--
-- The DTOs normalise on the way in from now on. These statements bring the rows
-- that were written before that into the same shape, so an existing driver can
-- keep logging in however they type it.
--
-- Uzbekistan is +998 with a nine-digit national number. Numbers that already
-- carry a country code are left alone beyond stripping punctuation: guessing a
-- country for a foreign driver would turn a working number into a wrong one.

-- Users -------------------------------------------------------------------
UPDATE "users" SET "phone" =
  CASE
    WHEN "phone" LIKE '+%'                     THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^998\d{9}$'
                                               THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^8\d{9}$'
                                               THEN '+998' || substring(regexp_replace("phone", '\D', '', 'g') from 2)
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^\d{9}$'
                                               THEN '+998' || regexp_replace("phone", '\D', '', 'g')
    ELSE '+' || regexp_replace("phone", '\D', '', 'g')
  END
WHERE "phone" IS NOT NULL
  AND "phone" <> '' 
  AND "phone" !~ '^\+\d{8,15}$';

-- Drivers -----------------------------------------------------------------
UPDATE "drivers" SET "phone" =
  CASE
    WHEN "phone" LIKE '+%'                     THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^998\d{9}$'
                                               THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^8\d{9}$'
                                               THEN '+998' || substring(regexp_replace("phone", '\D', '', 'g') from 2)
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^\d{9}$'
                                               THEN '+998' || regexp_replace("phone", '\D', '', 'g')
    ELSE '+' || regexp_replace("phone", '\D', '', 'g')
  END
WHERE "phone" IS NOT NULL
  AND "phone" <> ''
  AND "phone" !~ '^\+\d{8,15}$';

-- Clients -----------------------------------------------------------------
UPDATE "clients" SET "phone" =
  CASE
    WHEN "phone" LIKE '+%'                     THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^998\d{9}$'
                                               THEN '+' || regexp_replace("phone", '\D', '', 'g')
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^8\d{9}$'
                                               THEN '+998' || substring(regexp_replace("phone", '\D', '', 'g') from 2)
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^\d{9}$'
                                               THEN '+998' || regexp_replace("phone", '\D', '', 'g')
    ELSE '+' || regexp_replace("phone", '\D', '', 'g')
  END
WHERE "phone" IS NOT NULL
  AND "phone" <> ''
  AND "phone" !~ '^\+\d{8,15}$';
