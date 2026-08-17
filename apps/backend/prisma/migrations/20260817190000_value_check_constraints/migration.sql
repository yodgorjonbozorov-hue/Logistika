-- Value constraints at the database level (TASK-3.6).
--
-- Application validation is where a user gets a useful message, but it is not
-- where the guarantee lives: a seed script, a manual UPDATE during an incident,
-- a future endpoint that forgets a check, or an import job all reach the table
-- directly. Money that has gone negative is discovered months later, in a
-- report nobody can reconcile.
--
-- Every constraint below is written so a NULL passes: an unknown reading is not
-- a wrong one, and most of these columns are legitimately optional.
--
-- Verified before writing: no existing row violates any of them.

-- Trips -----------------------------------------------------------------
-- An odometer only counts up. A backwards reading produced a negative
-- distance, which silently poisoned the fuel norm and the cost per km.
ALTER TABLE "trips"
  ADD CONSTRAINT "trips_odometer_order_check"
  CHECK ("start_odometer" IS NULL OR "end_odometer" IS NULL OR "end_odometer" >= "start_odometer");

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_odometer_nonnegative_check"
  CHECK (COALESCE("start_odometer", 0) >= 0 AND COALESCE("end_odometer", 0) >= 0);

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_distance_nonnegative_check"
  CHECK (COALESCE("actual_distance_km", 0) >= 0 AND COALESCE("planned_distance_km", 0) >= 0);

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_money_nonnegative_check"
  CHECK ("agreed_price" >= 0 AND "driver_advance" >= 0 AND COALESCE("delivered_amount", 0) >= 0);

-- A partial delivery cannot be worth more than the whole job was.
ALTER TABLE "trips"
  ADD CONSTRAINT "trips_delivered_within_agreed_check"
  CHECK ("delivered_amount" IS NULL OR "delivered_amount" <= "agreed_price");

-- Expenses ---------------------------------------------------------------
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_money_nonnegative_check"
  CHECK ("amount" >= 0 AND "amount_base" >= 0 AND COALESCE("unit_price", 0) >= 0);

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_quantity_nonnegative_check"
  CHECK (COALESCE("quantity", 0) >= 0);

-- Incomes ----------------------------------------------------------------
ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_money_nonnegative_check"
  CHECK ("amount" >= 0 AND "amount_base" >= 0);

-- Fuel logs --------------------------------------------------------------
-- Zero litres is not a refuelling; it is a row that divides a norm by nothing.
ALTER TABLE "fuel_logs"
  ADD CONSTRAINT "fuel_logs_liters_positive_check"
  CHECK ("liters" > 0);

ALTER TABLE "fuel_logs"
  ADD CONSTRAINT "fuel_logs_money_nonnegative_check"
  CHECK (COALESCE("price_per_liter", 0) >= 0 AND COALESCE("total_amount", 0) >= 0
         AND COALESCE("odometer", 0) >= 0);

-- Ledger -----------------------------------------------------------------
-- Direction carries the sign, so an amount never does. A negative CREDIT and a
-- positive DEBIT would mean the same thing and the balance would be unreadable.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_nonnegative_check"
  CHECK ("amount" >= 0 AND "amount_base" >= 0);

-- Exchange rates ---------------------------------------------------------
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_positive_check"
  CHECK ("rate_to_uzs" > 0);
