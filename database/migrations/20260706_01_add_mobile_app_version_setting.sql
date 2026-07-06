INSERT INTO public.settings (setting_key, setting_value) VALUES ('mobile_app_version', '1.0.0') ON CONFLICT (setting_key) DO NOTHING;
