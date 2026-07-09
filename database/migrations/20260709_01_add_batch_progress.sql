-- Migration: Add progress tracking columns to duplicate_suggestion_batch
ALTER TABLE public.duplicate_suggestion_batch
    ADD COLUMN IF NOT EXISTS total_clusters INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS processed_clusters INT NOT NULL DEFAULT 0;
