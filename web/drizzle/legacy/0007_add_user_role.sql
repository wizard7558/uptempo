-- Migration: Add role column to user table
-- Adds RBAC role column with default "client" for safe access control.
-- Valid roles: "owner", "stylist", "client"

ALTER TABLE "user" ADD COLUMN "role" text NOT NULL DEFAULT 'client';
