<?php

namespace App\Http\Requests;

use App\Rules\JpegPhoto;
use Illuminate\Foundation\Http\FormRequest;

class AnalyzeListingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'images' => ['required', 'array', 'min:1', 'max:5'],
            'images.*' => ['required', 'string', 'min:16', 'max:1500000', 'regex:/^[A-Za-z0-9+\/=]+$/', new JpegPhoto],
            'precisions' => ['nullable', 'string', 'max:300'],
            'style' => ['nullable', 'in:court,normal,detaille'],
            'hashtags' => ['nullable', 'boolean'],
            'signature' => ['nullable', 'string', 'max:300'],
        ];
    }
}
