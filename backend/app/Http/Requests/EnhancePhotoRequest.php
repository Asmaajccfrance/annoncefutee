<?php

namespace App\Http\Requests;

use App\Rules\JpegPhoto;
use App\Services\Photos\PhotoBrief;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class EnhancePhotoRequest extends FormRequest
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
            'image' => ['required', 'string', 'min:16', 'max:1500000', 'regex:/^[A-Za-z0-9+\/=]+$/', new JpegPhoto],
            'mode' => ['required', 'string', Rule::in(PhotoBrief::MODES)],
            'consigne' => ['sometimes', 'nullable', 'string', 'max:300'],
        ];
    }
}
