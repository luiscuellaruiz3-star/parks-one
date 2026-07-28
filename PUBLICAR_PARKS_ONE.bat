@echo off
setlocal
cd /d "%~dp0"
echo.
echo PARKS ONE - PUBLICACION FINAL
echo.
git add -A
git commit -m "Publica PARKS ONE final corregido"
if errorlevel 1 echo Aviso: puede que no hubiera cambios nuevos para confirmar.
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo SE DETECTO UN CONFLICTO. NO CONTINUES Y REVISA EL MENSAJE.
  pause
  exit /b 1
)
git push origin main
echo.
echo LISTO. Espera a que Vercel muestre Ready y presiona Ctrl+F5.
pause
