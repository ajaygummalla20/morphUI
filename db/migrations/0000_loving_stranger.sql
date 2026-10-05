CREATE TYPE "public"."business_type" AS ENUM('new', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('intimated', 'documents_pending', 'under_assessment', 'approved', 'settled', 'rejected', 'closed');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('own_damage', 'theft', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."customer_segment" AS ENUM('retail', 'sme', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('individual', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."endorsement_status" AS ENUM('requested', 'documents_pending', 'under_review', 'approved', 'rejected', 'completed');--> statement-breakpoint
CREATE TYPE "public"."endorsement_type" AS ENUM('address_change', 'name_correction', 'vehicle_transfer', 'hypothecation_add', 'hypothecation_remove', 'coverage_change', 'cancellation');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('petrol', 'diesel', 'cng', 'electric', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('draft', 'pending_payment', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('north', 'south', 'east', 'west', 'central');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('due', 'contacted', 'quoted', 'payment_pending', 'converted', 'lost', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('direct', 'agent', 'broker', 'digital', 'partner');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('private_car', 'two_wheeler', 'commercial_vehicle');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(120) NOT NULL,
	"city" varchar(80) NOT NULL,
	"state" varchar(80) NOT NULL,
	"region" "region" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_number" varchar(32) NOT NULL,
	"policy_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" "claim_type" NOT NULL,
	"status" "claim_status" NOT NULL,
	"incident_date" date NOT NULL,
	"intimation_date" date NOT NULL,
	"claimed_amount" numeric(14, 2) NOT NULL,
	"approved_amount" numeric(14, 2),
	"settled_amount" numeric(14, 2),
	"cause" varchar(180) NOT NULL,
	"surveyor_name" varchar(120),
	"garage_name" varchar(160),
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_valid_dates_chk" CHECK ("claims"."intimation_date" >= "claims"."incident_date"),
	CONSTRAINT "claims_non_negative_amount_chk" CHECK ("claims"."claimed_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_number" varchar(20) NOT NULL,
	"type" "customer_type" NOT NULL,
	"segment" "customer_segment" NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(180) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"city" varchar(80) NOT NULL,
	"state" varchar(80) NOT NULL,
	"postal_code" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endorsements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endorsement_number" varchar(32) NOT NULL,
	"policy_id" uuid NOT NULL,
	"type" "endorsement_type" NOT NULL,
	"status" "endorsement_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"effective_date" date NOT NULL,
	"premium_delta" numeric(14, 2) DEFAULT 0 NOT NULL,
	"notes" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_number" varchar(32) NOT NULL,
	"previous_policy_id" uuid,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"relationship_manager_id" uuid NOT NULL,
	"business_type" "business_type" NOT NULL,
	"status" "policy_status" NOT NULL,
	"channel" "sales_channel" NOT NULL,
	"start_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"sum_insured" numeric(14, 2) NOT NULL,
	"own_damage_premium" numeric(14, 2) NOT NULL,
	"third_party_premium" numeric(14, 2) NOT NULL,
	"gst_amount" numeric(14, 2) NOT NULL,
	"total_premium" numeric(14, 2) NOT NULL,
	"payment_status" "payment_status" NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_valid_dates_chk" CHECK ("policies"."expiry_date" > "policies"."start_date"),
	CONSTRAINT "policies_non_negative_values_chk" CHECK ("policies"."sum_insured" >= 0 and "policies"."total_premium" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(24) NOT NULL,
	"name" varchar(140) NOT NULL,
	"category" "vehicle_type" NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" varchar(20) NOT NULL,
	"branch_id" uuid NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(180) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"joined_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"renewed_policy_id" uuid,
	"assigned_to_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"status" "renewal_status" NOT NULL,
	"current_premium" numeric(14, 2) NOT NULL,
	"quoted_premium" numeric(14, 2),
	"propensity_score" numeric(5, 2) NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"lost_reason" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewals_propensity_score_chk" CHECK ("renewals"."propensity_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"registration_number" varchar(20) NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"make" varchar(80) NOT NULL,
	"model" varchar(80) NOT NULL,
	"variant" varchar(100) NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"manufacture_year" integer NOT NULL,
	"engine_number" varchar(40) NOT NULL,
	"chassis_number" varchar(40) NOT NULL,
	"insured_declared_value" numeric(14, 2) NOT NULL,
	CONSTRAINT "vehicles_year_chk" CHECK ("vehicles"."manufacture_year" between 1995 and 2100)
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_previous_policy_id_policies_id_fk" FOREIGN KEY ("previous_policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_relationship_manager_id_relationship_managers_id_fk" FOREIGN KEY ("relationship_manager_id") REFERENCES "public"."relationship_managers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_managers" ADD CONSTRAINT "relationship_managers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_renewed_policy_id_policies_id_fk" FOREIGN KEY ("renewed_policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_assigned_to_id_relationship_managers_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."relationship_managers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_code_uidx" ON "branches" USING btree ("code");--> statement-breakpoint
CREATE INDEX "branches_region_idx" ON "branches" USING btree ("region");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_number_uidx" ON "claims" USING btree ("claim_number");--> statement-breakpoint
CREATE INDEX "claims_policy_idx" ON "claims" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "claims_status_intimation_idx" ON "claims" USING btree ("status","intimation_date");--> statement-breakpoint
CREATE INDEX "claims_branch_intimation_idx" ON "claims" USING btree ("branch_id","intimation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_number_uidx" ON "customers" USING btree ("customer_number");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_uidx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_segment_idx" ON "customers" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "customers_location_idx" ON "customers" USING btree ("state","city");--> statement-breakpoint
CREATE UNIQUE INDEX "endorsements_number_uidx" ON "endorsements" USING btree ("endorsement_number");--> statement-breakpoint
CREATE INDEX "endorsements_policy_idx" ON "endorsements" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "endorsements_status_requested_idx" ON "endorsements" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_number_uidx" ON "policies" USING btree ("policy_number");--> statement-breakpoint
CREATE INDEX "policies_customer_idx" ON "policies" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "policies_expiry_status_idx" ON "policies" USING btree ("expiry_date","status");--> statement-breakpoint
CREATE INDEX "policies_branch_expiry_idx" ON "policies" USING btree ("branch_id","expiry_date");--> statement-breakpoint
CREATE INDEX "policies_rm_expiry_idx" ON "policies" USING btree ("relationship_manager_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "products_code_uidx" ON "products" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_managers_employee_uidx" ON "relationship_managers" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_managers_email_uidx" ON "relationship_managers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "relationship_managers_branch_idx" ON "relationship_managers" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renewals_policy_uidx" ON "renewals" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "renewals_due_status_idx" ON "renewals" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "renewals_assignee_due_idx" ON "renewals" USING btree ("assigned_to_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_policy_uidx" ON "vehicles" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "vehicles_registration_idx" ON "vehicles" USING btree ("registration_number");