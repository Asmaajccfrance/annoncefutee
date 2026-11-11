<?php

// Simulateur local d'OpenAI. Il compte les appels et ne journalise ni corps ni en-tête.

$countFile = sys_get_temp_dir().DIRECTORY_SEPARATOR.'vinted-ia-openai-mock.count';
$handle = fopen($countFile, 'c+');
flock($handle, LOCK_EX);
$count = (int) stream_get_contents($handle);
$count++;
ftruncate($handle, 0);
rewind($handle);
fwrite($handle, (string) $count);
fflush($handle);
flock($handle, LOCK_UN);
fclose($handle);

usleep(1500000);

$annonce = [
    'titre' => 'Pull marine',
    'description' => 'Pull en coton, taille M, trou visible au coude.',
    'categorie' => 'Hommes',
    'sous_categorie' => 'Pulls et gilets',
    'marque' => '',
    'taille' => 'M',
    'etat' => 'Bon état',
    'couleurs' => ['Marine'],
    'matiere' => 'Coton',
    'prix_suggere' => 18.2,
    'a_verifier' => [],
];

header('Content-Type: application/json');
echo json_encode([
    'choices' => [[
        'message' => ['content' => json_encode($annonce)],
    ]],
    'usage' => [
        'prompt_tokens' => 1000,
        'completion_tokens' => 200,
    ],
], JSON_UNESCAPED_UNICODE);
