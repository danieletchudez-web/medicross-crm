# Recuperación de contraseña en Supabase

## Configuración manual

1. En Supabase, abrir `Authentication > URL Configuration`.
2. En `Redirect URLs`, agregar:

   `https://crm.medicross.com.ar/?recovery=1`

3. Abrir `Authentication > Email Templates > Reset Password`.
4. Usar como asunto:

   `Recuperá tu acceso a MediCross`

5. Copiar el contenido de `docs/supabase-password-recovery-template.html` en el cuerpo HTML de la plantilla y guardar.

## Remitente personalizado

Para reemplazar `Supabase Auth <noreply@mail.app.supabase.io>` por un remitente corporativo, configurar SMTP propio en Supabase y usar, por ejemplo:

`MediCross <noreply@medicross.com.ar>`

La plantilla usa `{{ .ConfirmationURL }}`, la variable oficial de Supabase para el enlace seguro de recuperación.
