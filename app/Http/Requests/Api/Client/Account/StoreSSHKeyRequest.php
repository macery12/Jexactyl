<?php

namespace Everest\Http\Requests\Api\Client\Account;

use phpseclib4\Crypt\DSA;
use phpseclib4\Crypt\RSA;
use Everest\Models\UserSSHKey;
use Illuminate\Validation\Validator;
use phpseclib4\Crypt\PublicKeyLoader;
use phpseclib4\Crypt\Common\PublicKey;
use phpseclib4\Exception\BaseException;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class StoreSSHKeyRequest extends ClientApiRequest
{
    protected ?PublicKey $key;

    /**
     * Returns the rules for this request.
     */
    public function rules(): array
    {
        return [
            'name' => UserSSHKey::getRulesForField('name'),
            'public_key' => UserSSHKey::getRulesForField('public_key'),
        ];
    }

    /**
     * Check to see if this SSH key has already been added to the user's account
     * and if so return an error.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function () {
            try {
                $this->key = PublicKeyLoader::loadPublicKey($this->input('public_key'));
            } catch (BaseException) {
                $this->validator->errors()->add('public_key', 'The public key provided is not valid.');

                return;
            }

            if ($this->key instanceof DSA) {
                $this->validator->errors()->add('public_key', 'DSA keys are not supported.');
            }

            if ($this->key instanceof RSA && $this->key->getLength() < 2048) {
                $this->validator->errors()->add('public_key', 'RSA keys must be at least 2048 bits in length.');
            }

            $fingerprint = $this->key->getFingerprint('sha256');
            if ($this->user()->sshKeys()->where('fingerprint', $fingerprint)->exists()) {
                $this->validator->errors()->add('public_key', 'The public key provided already exists on your account.');
            }
        });
    }

    /**
     * Returns the public key but formatted in a consistent manner.
     */
    public function getPublicKey(): string
    {
        return $this->key->toString('PKCS8');
    }

    /**
     * Returns the SHA256 fingerprint of the key provided.
     */
    public function getKeyFingerprint(): string
    {
        if (!$this->key) {
            throw new \Exception('The public key was not properly loaded for this request.');
        }

        return $this->key->getFingerprint('sha256');
    }
}
