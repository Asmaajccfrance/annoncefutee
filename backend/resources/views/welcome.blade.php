<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="description" content="Annonce Futée prépare le titre, la description et le prix d'une annonce à partir de vos photos. Le service n'est pas encore ouvert.">
    <title>Annonce Futée — Préparation</title>
    <link rel="icon" href="/icone-annonce-futee.png" type="image/png">
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=fraunces:500,560i|outfit:400,500" rel="stylesheet">
    <style>
        :root {
            --ink: #1C1915;
            --ink-soft: #5C564C;
            --paper: #F4F1EA;
            --surface: #FFFCF7;
            --line: #E4DDD2;
            --pine: #1F6F66;
            --sand: #E7D7BE;
            color-scheme: light;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --ink: #F4F1EA;
                --ink-soft: #C8C0B4;
                --paper: #161411;
                --surface: #221F1B;
                --line: #3A342C;
                --sand: #4A3F32;
                color-scheme: dark;
            }
        }

        * { box-sizing: border-box; }

        html, body { margin: 0; min-height: 100%; }

        body {
            background:
                radial-gradient(900px 420px at 80% -10%, color-mix(in srgb, var(--sand) 70%, transparent), transparent 70%),
                var(--paper);
            color: var(--ink);
            font-family: Outfit, "Segoe UI", sans-serif;
            font-size: 16px;
            line-height: 1.5;
        }

        main {
            max-width: 40rem;
            margin: 0 auto;
            padding: 48px 24px 32px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .logo {
            width: min(100%, 28rem);
            height: auto;
            display: block;
            margin: 0 0 28px;
        }

        p.domain {
            margin: 0 0 16px;
            color: var(--pine);
            font-size: 13px;
            font-weight: 500;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        h1 {
            margin: 0;
            font-family: Fraunces, Georgia, serif;
            font-size: clamp(2rem, 5vw, 3.25rem);
            font-weight: 560;
            letter-spacing: -0.03em;
            line-height: 1.08;
        }

        h1 em {
            font-style: italic;
            font-weight: 500;
        }

        .lead {
            margin: 24px 0 0;
            max-width: 34rem;
            color: var(--ink-soft);
            font-size: 1.05rem;
        }

        .status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 32px;
            padding: 8px 12px;
            border: 1px solid var(--line);
            border-radius: 999px;
            background: var(--surface);
            color: var(--ink);
            font-size: 13px;
            font-weight: 500;
        }

        .status i {
            width: 0.5rem;
            height: 0.5rem;
            border-radius: 50%;
            background: var(--pine);
            display: block;
        }

        ul {
            list-style: none;
            margin: 48px 0 0;
            padding: 0;
            border-top: 1px solid var(--line);
        }

        li {
            padding: 16px 0;
            border-bottom: 1px solid var(--line);
            color: var(--ink);
        }

        footer {
            margin-top: auto;
            padding-top: 48px;
            color: var(--ink-soft);
            font-size: 13px;
        }

        @media (prefers-reduced-motion: reduce) {
            * { scroll-behavior: auto; }
        }
    </style>
</head>
<body>
    <main>
        <img class="logo" src="/logo-annonce-futee.jpg" alt="Annonce Futée">
        <p class="domain">annoncefutee.fr</p>
        <h1>Vos photos.<br><em>Une annonce prête à relire.</em></h1>
        <p class="lead">Annonce Futée prépare le titre, la description et le prix à partir des photos que vous avez déjà choisies. Vous vérifiez, puis vous publiez vous-même.</p>
        <p class="status"><i aria-hidden="true"></i> Ouverture en préparation</p>
        <ul>
            <li>Le texte part des photos déjà choisies.</li>
            <li>Chaque proposition se relit avant la publication.</li>
            <li>L'envoi de l'annonce reste entre vos mains.</li>
        </ul>
        <footer>Le service n'est pas encore ouvert aux inscriptions.</footer>
    </main>
</body>
</html>
