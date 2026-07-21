import { forwardRef } from 'react';
import * as React from 'react';
import { Form } from 'formik';
import styled from 'styled-components';
import { breakpoint } from '@/assets/theme';
import FlashMessageRender from '@/elements/FlashMessageRender';
import tw from 'twin.macro';

type Props = React.DetailedHTMLProps<React.FormHTMLAttributes<HTMLFormElement>, HTMLFormElement> & {
    title?: string;
};

const Container = styled.div`
    ${breakpoint('sm')`
        ${tw`w-4/5 mx-auto`}
    `};

    ${breakpoint('md')`
        ${tw`p-10`}
    `};

    ${breakpoint('lg')`
        ${tw`w-3/5`}
    `};

    ${breakpoint('xl')`
        ${tw`w-full my-auto`}
    `};
`;

export default forwardRef<HTMLFormElement, Props>(({ title, ...props }, ref) => {
    return (
        <Container>
            <div className={'grid w-full 2xl:grid-cols-2'}>
                <div className={'w-full lg:mx-auto lg:w-1/2'}>
                    {title && <h2 css={tw`text-3xl text-center text-neutral-100 font-medium py-4`}>{title}</h2>}
                    <FlashMessageRender css={tw`mb-2 px-1`} />
                    <Form {...props} ref={ref}>
                        <div css={tw`w-full bg-zinc-800/50 shadow-lg rounded-lg p-6 mx-1`}>
                            <div css={tw`flex-1`}>{props.children}</div>
                        </div>
                    </Form>
                    <p css={tw`text-center text-neutral-300 text-xs mt-4`}>
                        &copy; {new Date().getFullYear()}&nbsp;
                        <a
                            rel={'noopener nofollow noreferrer'}
                            href={'https://m12labs.net'}
                            target={'_blank'}
                            css={tw`no-underline text-neutral-300 hover:text-green-400 duration-300`}
                        >
                            M12Labs.net
                        </a>
                        &nbsp;&middot;&nbsp;
                        <a
                            rel={'noopener nofollow noreferrer'}
                            href={'https://jexpanel.com'}
                            target={'_blank'}
                            css={tw`no-underline text-neutral-300 hover:text-green-400 duration-300`}
                        >
                            Jexpanel.com
                        </a>
                    </p>
                </div>
            </div>
        </Container>
    );
});
