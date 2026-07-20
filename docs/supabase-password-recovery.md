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

## Error `Invalid API key`

Este error no corresponde a `VITE_SUPABASE_ANON_KEY`. Lo devuelve el proveedor
de correo configurado en `Authentication > Email > SMTP Settings` cuando la
contraseña/API key SMTP fue revocada, venció o pertenece a otro servicio.

Para corregirlo en producción:

1. Crear una API key nueva en el proveedor de correo con permiso para enviar.
2. En Supabase, abrir `Project Settings > Authentication > SMTP Settings`.
3. Reemplazar `Password` por la clave nueva y verificar también `Host`, `Port`,
   `Username`, `Sender email` y `Sender name`.
4. Guardar y probar nuevamente "Olvidé mi contraseña".

Como recuperación temporal, se puede desactivar `Custom SMTP` para volver al
servicio de correo integrado de Supabase, teniendo en cuenta sus límites de
envío. Las claves SMTP son secretos de infraestructura y nunca deben agregarse
al frontend ni al repositorio.
