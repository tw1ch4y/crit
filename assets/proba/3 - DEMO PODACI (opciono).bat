@echo off
title Crit - demo podaci za probu
echo.
echo  ==========================================================
echo   DEMO PODACI ZA PROBU
echo  ==========================================================
echo.
echo  Puni server podacima da launcher odmah izgleda kompletno:
echo    - baneri i CRIT promo
echo    - vidljiv shop (pica)
echo    - upaljen nagradni tocak
echo    - demo igrac "test" (test1234) sa kreditom i potrosnjom
echo.
echo  Server MORA da radi ("Pokreni server.bat" u folderu 1 - SERVER).
echo.
echo  Ovo je SAMO za probu. Za pravo postavljanje iskopiraj svez
echo  folder "1 - SERVER" da baza bude cista.
echo.
pause

node "%~dp0demo-podaci.mjs"

echo.
pause
