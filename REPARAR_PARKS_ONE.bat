@echo off
setlocal
cd /d "%~dp0"

if not exist "index.html" (
  echo ERROR: Coloca este archivo dentro de la carpeta del proyecto, junto a index.html.
  pause
  exit /b 1
)

copy /y "index.html" "index.html.respaldo" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='index.html';" ^
  "$s=[System.IO.File]::ReadAllText($p);" ^
  "$old1='const C=compute();D.regions=C.regions;D.all_files=C.files;';" ^
  "$new1='let C=null;';" ^
  "$old2='async function boot(){if(window.ParksCloud){try{await window.ParksCloud.init()}catch(e){console.error(e);alert(''Error de conexión: ''+e.message);return}}let load=0;';" ^
  "$new2='async function boot(){if(window.ParksCloud){try{await window.ParksCloud.init()}catch(e){console.error(e);alert(''Error de conexión: ''+e.message);return}}C=compute();D.regions=C.regions;D.all_files=C.files;let load=0;';" ^
  "if(-not $s.Contains($old1)){Write-Error 'No se encontró el bloque C original. No se modificó nada.'; exit 2};" ^
  "if(-not $s.Contains($old2)){Write-Error 'No se encontró el inicio de boot original. No se modificó nada.'; exit 3};" ^
  "$s=$s.Replace($old1,$new1).Replace($old2,$new2);" ^
  "[System.IO.File]::WriteAllText($p,$s,(New-Object System.Text.UTF8Encoding($false)))"

if errorlevel 1 (
  echo.
  echo No se aplico el cambio. Se conserva index.html.respaldo.
  pause
  exit /b 1
)

echo.
echo Cambio aplicado. Verificando...
findstr /C:"let C=null;" "index.html" >nul || (
  echo ERROR: No se encontro let C=null.
  pause
  exit /b 1
)

git add index.html
git commit -m "Sincroniza interfaz despues de cargar Supabase"
git push origin main

echo.
echo LISTO. Espera a que Vercel marque Ready y abre PARKS ONE con Ctrl+F5.
echo El respaldo quedo como index.html.respaldo
pause
