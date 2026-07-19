# Despliegue seguro — flujo colaborativo de Cotizaciones

Este cambio es aditivo: conserva `cotizaciones`, `renglones`, PDFs, autenticación, permisos existentes y consultas históricas. No se debe ejecutar la migración de rollback salvo una incidencia confirmada.

## 1. Preflight

1. Crear un backup de la base de datos desde Supabase.
2. Confirmar que producción tiene las tablas `cotizaciones`, `profiles`, `crm_settings` y `crm_notifications`.
3. Guardar el commit actualmente desplegado para poder volver a publicar el frontend anterior.
4. Ejecutar primero la migración en un proyecto de staging o una rama de base de datos.

## 2. Base de datos

Aplicar, en orden:

1. `supabase/migrations/20260718200000_quotation_collaboration.sql`
2. No aplicar `20260718200001_quotation_collaboration_rollback.sql`; es sólo contingencia.

La migración crea el modelo normalizado, historial de costos, validaciones parciales/incrementales, actividad, comentarios, revisiones, adjuntos privados, RLS, métricas y sincronización bidireccional con el JSON legado.

## 3. Sectores

Desde Administración → Usuarios, asignar `department`:

- `ventas`
- `compras`
- `licitaciones`
- `administracion`

Los `super_admin` mantienen acceso completo. Verificar al menos un usuario activo en Compras y uno en Licitaciones antes del piloto.

## 4. Prueba funcional obligatoria

Usar una cotización de prueba con 12 renglones:

1. Ventas guarda y envía a Compras.
2. Compras toma la solicitud y carga costo en 8 renglones.
3. En los otros 4 guarda motivo y observación de pendiente.
4. Compras realiza validación parcial de los 8 disponibles.
5. Ventas debe ver exactamente: **“Cotización validada parcialmente: 8 de 12 renglones disponibles para definición comercial.”**
6. Ventas puede editar sólo esos 8; los 4 pendientes siguen visibles y bloqueados.
7. Compras completa y valida incrementalmente los 4 restantes.
8. Ventas define todos los renglones y envía a Licitaciones.
9. Validar historial, comentarios, descarga de documentos, bandeja por sector e Inteligencia de Cotizaciones.
10. Generar el PDF legado y comprobar importes y descripción.

Repetir en desktop y móvil, con un usuario real de cada sector. Revisar que un usuario sin acceso no pueda leer adjuntos por URL.

## 5. Publicación

1. Ejecutar `npm run build`.
2. Publicar el contenido generado en `dist` con el procedimiento actual del hosting.
3. Abrir una ventana privada y hacer una recarga completa.
4. Revisar Consola y Red: no debe haber errores 401/403 para un usuario autorizado.
5. Mantener el piloto observado durante las primeras operaciones reales.

## 6. Contingencia

Si falla únicamente la interfaz, volver a publicar el frontend anterior; los datos nuevos pueden permanecer sin afectar el Cotizador legado.

Si es necesario desactivar el flujo en base de datos, ejecutar `20260718200001_quotation_collaboration_rollback.sql`. Este rollback desactiva la bandera y revoca el acceso API, pero deliberadamente no borra datos ni archivos.

Nunca eliminar las tablas o el bucket hasta exportar y revisar la retención de datos.
