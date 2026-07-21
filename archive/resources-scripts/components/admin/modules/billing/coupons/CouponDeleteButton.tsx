import { deleteCoupon } from '@/api/routes/admin/billing/coupons';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Input from '@/elements/Input';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import useFlash from '@/plugins/useFlash';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coupon } from '@definitions/admin';

export default ({ coupon }: { coupon: Coupon }) => {
    const navigate = useNavigate();
    const [code, setCode] = useState<string>('');
    const [open, setOpen] = useState<boolean>(false);
    const { clearFlashes, addFlash, clearAndAddHttpError } = useFlash();

    const doDeletion = () => {
        clearFlashes();

        if (code !== coupon.code) {
            addFlash({
                type: 'error',
                key: 'admin:billing:coupons:delete',
                message: 'The coupon code does not match.',
            });

            return;
        }

        deleteCoupon(coupon.id)
            .then(() => navigate('/admin/billing/coupons'))
            .catch(error => clearAndAddHttpError({ key: 'admin:billing:coupons:delete', error }));
    };

    return (
        <>
            <Dialog.Confirm
                open={open}
                onConfirmed={doDeletion}
                onClose={() => setOpen(false)}
                title={'Confirm coupon deletion'}
            >
                <FlashMessageRender byKey={'admin:billing:coupons:delete'} className={'mb-2'} />
                Are you sure you want to delete this coupon? This action cannot be undone. To confirm, please type the
                coupon code&nbsp;
                <span className={'mx-1 rounded bg-zinc-900 p-1 font-mono text-sm'}>({coupon.code})</span>below:
                <Input onChange={e => setCode(e.currentTarget.value)} className={'mt-2'} />
            </Dialog.Confirm>
            <Button.Danger className={'mr-4'} type={'button'} onClick={() => setOpen(true)}>
                <FontAwesomeIcon icon={faTrash} className={'mr-1'} /> Delete Coupon
            </Button.Danger>
        </>
    );
};
