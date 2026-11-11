<?php

namespace App\Exceptions;

class IncompleteListing extends ApiException
{
    /**
     * @param  array{prompt_tokens: int, completion_tokens: int}  $usage
     */
    public function __construct(public readonly array $usage)
    {
        parent::__construct('invalid_listing', 'L\'annonce reçue est incomplète.', 502);
    }
}
